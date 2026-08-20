import os
import unittest

import app


VALID_RESPONSE = {
    "intent": "calendar.create",
    "confidence": 0.96,
    "title": "Cena con Pedro",
    "date": "2026-08-21",
    "time": "21:00",
    "location": None,
    "contactName": None,
    "phone": None,
    "notes": None,
    "target": None,
    "changes": None,
    "requiresConfirmation": True,
}


class InterpretEndpointTests(unittest.TestCase):
    def setUp(self):
        os.environ["ANGELI_AI_DEV_BYPASS_AUTH"] = "1"
        os.environ.pop("K_SERVICE", None)
        app._rate_windows.clear()
        app.set_test_dependencies(lambda text, now, timezone: VALID_RESPONSE.copy())

    def tearDown(self):
        app.set_test_dependencies()
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)

    def test_accepts_valid_request_and_returns_validated_schema(self):
        status, data = app.wsgi_request({"text": "Cena con Pedro mañana a las nueve", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(data, VALID_RESPONSE)

    def test_rejects_text_over_500_characters_before_interpretation(self):
        status, data = app.wsgi_request({"text": "x" * 501, "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "400 Bad Request")
        self.assertIn("500", data["error"])

    def test_rejects_malformed_model_response(self):
        app.set_test_dependencies(lambda text, now, timezone: {"intent": "javascript.eval"})
        status, data = app.wsgi_request({"text": "Idea", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "503 Service Unavailable")
        self.assertEqual(data["error"], "Interpretación no disponible")

    def test_requires_confirmation_for_sensitive_intent(self):
        response = VALID_RESPONSE | {"intent": "calendar.delete", "target": {"title": "Cena con Pedro", "date": "2026-08-21", "time": None}, "requiresConfirmation": False}
        app.set_test_dependencies(lambda text, now, timezone: response)
        status, data = app.wsgi_request({"text": "Cancela la cena", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "200 OK")
        self.assertTrue(data["requiresConfirmation"])

    def test_rejects_unapproved_identity(self):
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_GOOGLE_SUBS"] = "approved-sub"
        app.set_test_dependencies(lambda text, now, timezone: VALID_RESPONSE.copy(), lambda token: {"sub": "other-sub"})
        status, data = app.wsgi_request({"text": "Idea", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"}, "Bearer test")
        self.assertEqual(status, "401 Unauthorized")
        self.assertEqual(data["error"], "No autorizado")
        os.environ.pop("ALLOWED_GOOGLE_SUBS", None)


if __name__ == "__main__":
    unittest.main()
