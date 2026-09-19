"""Catálogo de Mercadona para emparejar artículos de la lista de la compra.

Mercadona no tiene una API oficial para terceros. La búsqueda real del sitio
(tienda.mercadona.es) pasa por Algolia con credenciales internas que rotan
sin aviso — reproducirla exigiría extraerlas del bundle JS del sitio cada
vez que cambian, algo frágil y que se rompe solo. En cambio, `/api/categories/`
y `/api/categories/<id>/` son públicos, no requieren sesión ni pasan por el
Akamai que protege las operaciones autenticadas, y devuelven el árbol
completo de categorías con sus productos (nombre, precio, foto, enlace) tal
cual lo usa cualquier visitante anónimo de la web. Es más lento — hay que
recorrer todas las subcategorías — pero es la vía estable, así que el
catálogo se construye una vez y se cachea en memoria con un TTL.
"""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://tienda.mercadona.es/api"
CATALOG_TTL_SECONDS = 12 * 3600
REQUEST_TIMEOUT_SECONDS = 8
MAX_WORKERS = 12
USER_AGENT = "Mozilla/5.0 (compatible; AngeliSecretaria/1.0; +https://franbermudezes-cloud.github.io/angeli_secretaria/)"

_catalog: list[dict[str, Any]] = []
_catalog_expires_at = 0.0


def _get(path: str) -> dict[str, Any]:
    request = Request(BASE_URL + path, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


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
    sections = _get("/categories/").get("results", [])
    subcategory_ids = [category["id"] for section in sections for category in section.get("categories", []) if category.get("id")]
    products: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_get, f"/categories/{category_id}/"): category_id for category_id in subcategory_ids}
        for future in as_completed(futures):
            try:
                _flatten_products(future.result(), products)
            except (HTTPError, URLError, TimeoutError, ValueError):
                continue  # una subcategoría caída no debe tirar todo el catálogo
    return products


def _catalog_data(force: bool = False) -> list[dict[str, Any]]:
    global _catalog, _catalog_expires_at
    now = time.monotonic()
    if force or not _catalog or now >= _catalog_expires_at:
        fresh = _build_catalog()
        if fresh:
            _catalog, _catalog_expires_at = fresh, now + CATALOG_TTL_SECONDS
        elif not _catalog:
            raise RuntimeError("No se pudo cargar el catálogo de Mercadona")
    return _catalog


def search(query: str, limit: int = 6) -> list[dict[str, Any]]:
    terms = [word for word in str(query or "").lower().split() if word]
    if not terms:
        return []
    catalog = _catalog_data()
    scored = []
    for product in catalog:
        name = product["name"].lower()
        if not all(term in name for term in terms):
            continue
        rank = 0 if name.startswith(terms[0]) else 1
        scored.append((rank, len(name), product))
    scored.sort(key=lambda item: (item[0], item[1]))
    return [product for _, _, product in scored[:max(1, min(limit, 20))]]
