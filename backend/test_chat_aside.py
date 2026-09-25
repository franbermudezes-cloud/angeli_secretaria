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


class AsideToneTests(unittest.TestCase):
    """Pedido por el propietario: las reacciones sonaban secas. El tono es
    cálido, pero nunca da la tarea por hecha ni se pasa de confianza."""

    def test_prompt_is_warm_but_never_claims_done(self):
        prompt = app.ASIDE_SYSTEM_INSTRUCTION
        self.assertIn("entre 4 y 10 palabras", prompt)
        self.assertIn("no digas que ya está hecho", prompt)
        self.assertIn("cariño", prompt)  # prohibido como apelativo
        self.assertGreaterEqual(app.ASIDE_MAX_OUTPUT_TOKENS, 30)


class SpeechTests(unittest.TestCase):
    """Voz propia (Vindemiatrix): /speech devuelve MP3; si Google falla, 503
    y el móvil habla con su propia voz."""

    def setUp(self):
        os.environ["ANGELI_AI_DEV_BYPASS_AUTH"] = "1"
        os.environ.pop("K_SERVICE", None)
        app._rate_windows.clear()
        self.calls = []

    def tearDown(self):
        app.set_test_dependencies()
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)

    def raw(self, payload):
        body = json.dumps(payload).encode()
        captured = {}
        data = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": "/speech", "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": "Bearer test"}, lambda status, headers: captured.update(status=status, headers=dict(headers))))
        return captured, data

    def test_returns_mp3_and_caches_repeated_phrases(self):
        app.set_test_dependencies(speech=lambda text, rate: self.calls.append((text, rate)) or b"ID3audio")
        for _ in range(2):
            captured, data = self.raw({"text": "Claro, dame un segundito.", "rate": 1})
            self.assertEqual(captured["status"], "200 OK")
            self.assertEqual(captured["headers"]["Content-Type"], "audio/mpeg")
            self.assertEqual(data, b"ID3audio")
        self.assertEqual(self.calls, [("Claro, dame un segundito.", 1.0)], "la segunda vez sale de la memoria")

    def test_rate_is_clamped_and_text_validated(self):
        app.set_test_dependencies(speech=lambda text, rate: self.calls.append(rate) or b"x")
        self.raw({"text": "Hola", "rate": 9})
        self.assertEqual(self.calls, [1.6])
        captured, _ = self.raw({"text": "x" * 700})
        self.assertEqual(captured["status"], "400 Bad Request")

    def test_google_failure_is_503_so_the_phone_uses_its_own_voice(self):
        def broken(text, rate):
            raise RuntimeError("caído")
        app.set_test_dependencies(speech=broken)
        captured, data = self.raw({"text": "Hola"})
        self.assertEqual(captured["status"], "503 Service Unavailable")
        self.assertEqual(json.loads(data)["code"], "speech_unavailable")
