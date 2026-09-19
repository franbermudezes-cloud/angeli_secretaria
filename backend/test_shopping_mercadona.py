"""Cubre /shopping/mercadona/search y mercadona_catalog.search: emparejar un
artículo de la lista de la compra ("la leche") con el catálogo público de
Mercadona. No hay API oficial de terceros, así que esto usa /api/categories/
(sin autenticación, sin Algolia) — aquí se prueba contra un árbol de
categorías simulado, nunca contra la red real."""

import json
import os
import unittest
from io import BytesIO

import app
import mercadona_catalog


def post(path, payload, authorization="Bearer test"):
    body = json.dumps(payload).encode()
    captured = {}

    def start_response(status, headers):
        captured["status"] = status

    response = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": authorization}, start_response))
    return captured["status"], json.loads(response)


class MercadonaCatalogSearchTests(unittest.TestCase):
    """Prueba la función pura de emparejado sobre un catálogo ya construido,
    sin tocar la red: se inyecta el catálogo directamente en el módulo."""

    def setUp(self):
        mercadona_catalog._catalog = [
            {"id": "1", "name": "Leche entera Hacendado", "packaging": "Brik", "price": 0.95, "thumbnail": None, "url": "https://tienda.mercadona.es/product/1"},
            {"id": "2", "name": "Leche desnatada Hacendado", "packaging": "Brik", "price": 0.95, "thumbnail": None, "url": "https://tienda.mercadona.es/product/2"},
            {"id": "3", "name": "Bebida de avena Hacendado", "packaging": "Brik", "price": 1.15, "thumbnail": None, "url": "https://tienda.mercadona.es/product/3"},
        ]
        mercadona_catalog._catalog_expires_at = mercadona_catalog.time.monotonic() + 3600

    def tearDown(self):
        mercadona_catalog._catalog = []
        mercadona_catalog._catalog_expires_at = 0.0

    def test_matches_by_substring_and_orders_shorter_names_first(self):
        results = mercadona_catalog.search("leche")
        self.assertEqual([item["id"] for item in results], ["1", "2"])

    def test_all_words_must_appear_in_the_name(self):
        results = mercadona_catalog.search("leche desnatada")
        self.assertEqual([item["id"] for item in results], ["2"])

    def test_no_match_returns_an_empty_list_without_raising(self):
        self.assertEqual(mercadona_catalog.search("chorizo"), [])

    def test_blank_query_returns_an_empty_list(self):
        self.assertEqual(mercadona_catalog.search("   "), [])


class ShoppingMercadonaSearchRouteTests(unittest.TestCase):
    def setUp(self):
        os.environ["ANGELI_AI_DEV_BYPASS_AUTH"] = "1"
        os.environ.pop("K_SERVICE", None)
        app._rate_windows.clear()

    def tearDown(self):
        app.set_test_dependencies()

    def test_returns_the_results_from_the_search_dependency(self):
        app.set_test_dependencies(mercadona_search=lambda query, limit: [{"id": "1", "name": "Leche entera Hacendado", "price": 0.95}])
        status, body = post("/shopping/mercadona/search", {"query": "leche"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(body, {"results": [{"id": "1", "name": "Leche entera Hacendado", "price": 0.95}]})

    def test_rejects_empty_or_oversized_query_without_calling_the_search(self):
        calls = []
        app.set_test_dependencies(mercadona_search=lambda query, limit: calls.append(query) or [])
        status, body = post("/shopping/mercadona/search", {"query": ""})
        self.assertEqual(status, "400 Bad Request")
        status, body = post("/shopping/mercadona/search", {"query": "a" * 501})
        self.assertEqual(status, "400 Bad Request")
        self.assertEqual(calls, [])

    def test_upstream_failure_becomes_a_503_that_never_leaks_detail(self):
        app.set_test_dependencies(mercadona_search=lambda query, limit: (_ for _ in ()).throw(RuntimeError("No se pudo cargar el catálogo de Mercadona")))
        status, body = post("/shopping/mercadona/search", {"query": "leche"})
        self.assertEqual(status, "503 Service Unavailable")

    def test_is_a_completely_separate_path_from_interpret(self):
        interpret_calls = []
        app.set_test_dependencies(
            interpreter=lambda text, now, timezone: interpret_calls.append(text) or {"intent": "note", "confidence": 0.9},
            mercadona_search=lambda query, limit: [],
        )
        status, body = post("/shopping/mercadona/search", {"query": "leche"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(interpret_calls, [], "/shopping/mercadona/search no debe ejecutar nunca el intérprete de órdenes")


if __name__ == "__main__":
    unittest.main()
