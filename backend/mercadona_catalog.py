"""Catálogo de Mercadona para emparejar artículos de la lista de la compra.

Mercadona no tiene una API oficial para terceros. La búsqueda real del sitio
(tienda.mercadona.es) pasa por Algolia con credenciales internas que rotan
sin aviso — reproducirla exigiría extraerlas del bundle JS del sitio cada
vez que cambian, algo frágil y que se rompe solo. En cambio, `/api/categories/`
y `/api/categories/<id>/` son públicos, no requieren sesión ni pasan por el
Akamai que protege las operaciones autenticadas, y devuelven el árbol
completo de categorías con sus productos (nombre, precio, foto, enlace) tal
cual lo usa cualquier visitante anónimo de la web. Es más lento — hay que
recorrer todas las subcategorías (~150) — pero es la vía estable, así que el
catálogo se construye una vez y se cachea en memoria con un TTL.
"""

from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://tienda.mercadona.es/api"
CATALOG_TTL_SECONDS = 12 * 3600
# Si una construcción sale con muchos menos productos de los esperados
# (varias subcategorías fallaron a la vez, p. ej. por límite de conexiones
# concurrentes), no se cachea 12h enteras como si fuera un catálogo bueno:
# se reintenta pronto. Detectado en real: la categoría de lácteos completa
# desapareció una vez así, y durante 12h "leche" no encontraba ni una sola
# leche de verdad, solo cafés y chocolates que también llevan la palabra.
CATALOG_MIN_PRODUCTS = 1500
CATALOG_RETRY_COOLDOWN_SECONDS = 5 * 60
REQUEST_TIMEOUT_SECONDS = 8
REQUEST_ATTEMPTS = 3
MAX_WORKERS = 8
USER_AGENT = "Mozilla/5.0 (compatible; AngeliSecretaria/1.0; +https://franbermudezes-cloud.github.io/angeli_secretaria/)"

_catalog: list[dict[str, Any]] = []
_catalog_expires_at = 0.0


def _get(path: str) -> dict[str, Any]:
    request = Request(BASE_URL + path, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _get_with_retry(path: str, attempts: int = REQUEST_ATTEMPTS) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return _get(path)
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            last_error = error
            if attempt < attempts - 1:
                time.sleep(0.3 * (attempt + 1))
    raise last_error  # type: ignore[misc]


def _flatten_products(node: dict[str, Any], out: list[dict[str, Any]]) -> None:
    for product in node.get("products", []) or []:
        instructions = product.get("price_instructions") or {}
        price = instructions.get("unit_price") or instructions.get("bulk_price")
        name = product.get("display_name")
        if not name:
            continue
        out.append({
            "id": str(product.get("id") or ""),
            "name": name,
            "packaging": product.get("packaging") or "",
            "price": float(price) if price not in (None, "") else None,
            "thumbnail": product.get("thumbnail"),
            "url": product.get("share_url"),
        })
    for child in node.get("categories", []) or []:
        _flatten_products(child, out)


def _build_catalog() -> list[dict[str, Any]]:
    sections = _get_with_retry("/categories/").get("results", [])
    subcategory_ids = [category["id"] for section in sections for category in section.get("categories", []) if category.get("id")]
    products: list[dict[str, Any]] = []
    failed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_get_with_retry, f"/categories/{category_id}/"): category_id for category_id in subcategory_ids}
        for future in as_completed(futures):
            try:
                _flatten_products(future.result(), products)
            except (HTTPError, URLError, TimeoutError, ValueError):
                failed += 1  # una subcategoría caída no debe tirar todo el catálogo
    if failed:
        print(f"mercadona_catalog_partial_build failed={failed} of={len(subcategory_ids)} products={len(products)}", file=sys.stderr, flush=True)
    return products


def _catalog_data() -> list[dict[str, Any]]:
    global _catalog, _catalog_expires_at
    now = time.monotonic()
    if _catalog and now < _catalog_expires_at:
        return _catalog
    fresh = _build_catalog()
    if not fresh and not _catalog:
        raise RuntimeError("No se pudo cargar el catálogo de Mercadona")
    if len(fresh) >= CATALOG_MIN_PRODUCTS:
        _catalog, _catalog_expires_at = fresh, now + CATALOG_TTL_SECONDS
    elif fresh:
        # Construcción incompleta: se usa si es mejor que lo que había (o si
        # no había nada), pero se reintenta pronto en vez de esperar 12h.
        if len(fresh) > len(_catalog):
            _catalog = fresh
        _catalog_expires_at = now + CATALOG_RETRY_COOLDOWN_SECONDS
        print(f"mercadona_catalog_too_small products={len(fresh)} threshold={CATALOG_MIN_PRODUCTS}", file=sys.stderr, flush=True)
    return _catalog


def _strip_accents(value: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFD", value) if unicodedata.category(char) != "Mn")


_WORD_RE = re.compile(r"\w+")


# Real detectado: "café cápsula" no encontraba "Café en cápsulas" — el
# singular no casaba con el plural del catálogo. El plural en español se
# forma añadiendo "s" (cápsula→cápsulas) o "es" (según cómo acabe la
# palabra); sin diccionario no se puede saber cuál aplica, así que se
# prueban ambas reducciones como candidatas, igual que ya se hace en
# js/shopping.js para los artículos de la lista.
def _word_stems(word: str) -> set[str]:
    stems = {word}
    if len(word) > 2 and word.endswith("s"):
        stems.add(word[:-1])
    if len(word) > 3 and word.endswith("es"):
        stems.add(word[:-2])
    return stems


def search(query: str, limit: int = 6) -> list[dict[str, Any]]:
    # "cafe" (sin tilde) tampoco encontraba "café" — muy fácil de escribir
    # así sin querer, sobre todo dictando. Se comparan sin acentos en los
    # dos lados para que dé igual cómo se haya escrito la tilde.
    terms = [_strip_accents(word) for word in str(query or "").lower().split() if word]
    if not terms:
        return []
    term_stem_sets = [_word_stems(term) for term in terms]
    catalog = _catalog_data()
    scored = []
    for product in catalog:
        name = _strip_accents(product["name"].lower())
        name_word_stems = [_word_stems(word) for word in _WORD_RE.findall(name)]
        # Coincidencia por palabra completa (con su plural/singular), no por
        # subcadena: "leche entera" no debe emparejar con "almendras
        # enteras" solo porque "entera" sea una subcadena literal de esa
        # palabra suelta del nombre.
        if not all(any(term_stems & word_stems for word_stems in name_word_stems) for term_stems in term_stem_sets):
            continue
        rank = 0 if name.startswith(terms[0]) else 1
        scored.append((rank, len(name), product))
    scored.sort(key=lambda item: (item[0], item[1]))
    return [product for _, _, product in scored[:max(1, min(limit, 30))]]
