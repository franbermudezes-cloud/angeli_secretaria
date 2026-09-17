"""Cubre /chat/aside: el módulo de charla suelta, deliberadamente separado
de vertex_interpret (prompt, esquema y caché propios). Nunca decide ni
ejecuta ninguna acción de negocio, así que un fallo aquí no debe poder
tocar notas, recordatorios ni eventos."""

import json
import os
import unittest
from io import BytesIO

import app


def post(path, payload, authorization="Bearer test"):
    body = json.dumps(payload).encode()
    captured = {}

    def start_response(status, headers):
        captured["status"] = status

    response = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": authorization}, start_response))
    return captured["status"], json.loads(response)


class ChatAsideTests(unittest.TestCase):
    def setUp(self):
        os.environ["ANGELI_AI_DEV_BYPASS_AUTH"] = "1"
        os.environ.pop("K_SERVICE", None)
        app._rate_windows.clear()

    def tearDown(self):
        app.set_test_dependencies()

    def test_returns_the_short_reply_from_the_aside_dependency(self):
        app.set_test_dependencies(chat_aside=lambda text: "¡Vale, voy!")
        status, body = post("/chat/aside", {"text": "apunta que compre leche"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(body, {"reply": "¡Vale, voy!"})

    def test_rejects_empty_or_oversized_text_without_calling_the_model(self):
        calls = []
        app.set_test_dependencies(chat_aside=lambda text: calls.append(text) or "x")
        status, body = post("/chat/aside", {"text": ""})
        self.assertEqual(status, "400 Bad Request")
        status, body = post("/chat/aside", {"text": "a" * 501})
        self.assertEqual(status, "400 Bad Request")
        self.assertEqual(calls, [])

    def test_a_bad_reply_from_the_model_never_becomes_a_500_that_leaks_detail(self):
        app.set_test_dependencies(chat_aside=lambda text: (_ for _ in ()).throw(ValueError("Respuesta de aside no válida")))
        status, body = post("/chat/aside", {"text": "apunta que compre leche"})
        self.assertEqual(status, "503 Service Unavailable")

    def test_is_a_completely_separate_path_from_interpret_and_never_falls_through_to_it(self):
        interpret_calls = []
        app.set_test_dependencies(
            interpreter=lambda text, now, timezone: interpret_calls.append(text) or {"intent": "note", "confidence": 0.9},
            chat_aside=lambda text: "¡Vale, voy!",
        )
        status, body = post("/chat/aside", {"text": "apunta que compre leche"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(interpret_calls, [], "/chat/aside no debe ejecutar nunca el intérprete de órdenes")


if __name__ == "__main__":
    unittest.main()
