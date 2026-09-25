"""Pruebas del control de acceso por invitación y cupo mensual."""

import json
import os
import unittest
from io import BytesIO

import app
from access_control import AccessControl, AccessDenied, QuotaExhausted, current_period

OWNER = "franbermudez.es@gmail.com"


def claims(email, uid="uid-1", verified=True):
    return {"uid": uid, "email": email, "email_verified": verified}


class AccessControlUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)
        self.store = {}
        self.access = AccessControl(store=self.store)

    def test_owner_is_always_allowed_and_never_counts(self):
        status = self.access.status(claims(OWNER))
        self.assertTrue(status["allowed"])
        self.assertTrue(status["owner"])
        self.assertIsNone(status["limit"])
        # Consumir muchas veces no gasta cupo ni escribe contador para el dueño.
        for _ in range(5):
            self.access.consume(claims(OWNER))
        self.assertNotIn(OWNER, self.store)

    def test_uninvited_account_is_denied(self):
        status = self.access.status(claims("desconocido@gmail.com"))
        self.assertFalse(status["allowed"])
        self.assertEqual(status["reason"], "not_invited")
        with self.assertRaises(AccessDenied):
            self.access.authorize(claims("desconocido@gmail.com"))

    def test_unverified_email_is_denied(self):
        status = self.access.status(claims("ana@gmail.com", verified=False))
        self.assertFalse(status["allowed"])
        self.assertEqual(status["reason"], "unverified")

    def test_blocked_account_is_denied_even_if_present(self):
        self.store["ana@gmail.com"] = {"status": "blocked", "mode": "trial", "monthlyLimit": 40}
        status = self.access.status(claims("ana@gmail.com"))
        self.assertFalse(status["allowed"])
        self.assertEqual(status["reason"], "blocked")
        with self.assertRaises(AccessDenied):
            self.access.consume(claims("ana@gmail.com"))

    def test_trial_within_limit_is_allowed_and_increments(self):
        self.store["ana@gmail.com"] = {"status": "active", "mode": "trial", "monthlyLimit": 3}
        self.access.consume(claims("ana@gmail.com"))
        self.access.consume(claims("ana@gmail.com"))
        record = self.store["ana@gmail.com"]
        self.assertEqual(record["usageCount"], 2)
        self.assertEqual(record["usagePeriod"], current_period())
        self.assertEqual(self.access.status(claims("ana@gmail.com"))["remaining"], 1)

    def test_trial_at_limit_raises_quota(self):
        self.store["ana@gmail.com"] = {"status": "active", "mode": "trial", "monthlyLimit": 2, "usagePeriod": current_period(), "usageCount": 2}
        with self.assertRaises(QuotaExhausted):
            self.access.consume(claims("ana@gmail.com"))
        # Un intento agotado no incrementa por encima del tope.
        self.assertEqual(self.store["ana@gmail.com"]["usageCount"], 2)

    def test_open_tap_counts_but_never_blocks(self):
        self.store["marta@gmail.com"] = {"status": "active", "mode": "open", "usagePeriod": current_period(), "usageCount": 999}
        self.access.consume(claims("marta@gmail.com"))  # no lanza
        self.assertEqual(self.store["marta@gmail.com"]["usageCount"], 1000)
        self.assertIsNone(self.access.status(claims("marta@gmail.com"))["remaining"])

    def test_usage_resets_when_month_rolls_over(self):
        self.store["ana@gmail.com"] = {"status": "active", "mode": "trial", "monthlyLimit": 5, "usagePeriod": "2000-01", "usageCount": 5}
        # Aunque el contador viejo esté al tope, un mes nuevo empieza de cero.
        self.access.consume(claims("ana@gmail.com"))
        self.assertEqual(self.store["ana@gmail.com"]["usageCount"], 1)
        self.assertEqual(self.store["ana@gmail.com"]["usagePeriod"], current_period())

    def test_missing_limit_falls_back_to_default(self):
        self.store["ana@gmail.com"] = {"status": "active", "mode": "trial"}
        self.assertEqual(self.access.status(claims("ana@gmail.com"))["limit"], app_default_limit())

    def test_legacy_env_list_is_allowed_and_uncounted(self):
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "heredado@example.com"
        try:
            status = self.access.status(claims("heredado@example.com"))
            self.assertTrue(status["allowed"])
            self.assertEqual(status["mode"], "open")
            self.access.consume(claims("heredado@example.com"))
            self.assertNotIn("heredado@example.com", self.store)
        finally:
            os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)


def app_default_limit():
    from access_control import DEFAULT_MONTHLY_LIMIT
    return DEFAULT_MONTHLY_LIMIT


class AccessDispatchTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ.pop("K_SERVICE", None)
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)
        self.store = {}

    def tearDown(self):
        app.set_test_dependencies()

    def _request(self, path, payload, email="ana@gmail.com"):
        app.set_test_dependencies(
            interpreter=lambda text, now, timezone: {"intent": "note", "confidence": 0.9},
            verifier=lambda token: claims(email),
            access_factory=lambda: AccessControl(store=self.store),
        )
        body = json.dumps(payload).encode("utf-8")
        captured = {}

        def start_response(status, headers):
            captured["status"] = status

        raw = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": "Bearer t"}, start_response))
        return captured["status"], json.loads(raw)

    def test_access_status_reports_not_invited_without_401(self):
        status, data = self._request("/access/status", {})
        self.assertEqual(status, "200 OK")
        self.assertFalse(data["allowed"])
        self.assertEqual(data["reason"], "not_invited")

    def test_access_status_reports_a_trial_user(self):
        self.store["ana@gmail.com"] = {"status": "active", "mode": "trial", "monthlyLimit": 40, "name": "Ana"}
        status, data = self._request("/access/status", {})
        self.assertEqual(status, "200 OK")
        self.assertTrue(data["allowed"])
        self.assertEqual(data["remaining"], 40)
        self.assertEqual(data["name"], "Ana")

    def test_interpret_is_blocked_when_quota_is_exhausted(self):
        self.store["ana@gmail.com"] = {"status": "active", "mode": "trial", "monthlyLimit": 1, "usagePeriod": current_period(), "usageCount": 1}
        status, data = self._request("/interpret", {"text": "hola", "now": "2026-09-21T10:00:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "429 Too Many Requests")
        self.assertEqual(data["code"], "quota_exhausted")

    def test_interpret_succeeds_and_counts_under_quota(self):
        self.store["ana@gmail.com"] = {"status": "active", "mode": "trial", "monthlyLimit": 5}
        status, data = self._request("/interpret", {"text": "hola", "now": "2026-09-21T10:00:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["intent"], "note")
        self.assertEqual(self.store["ana@gmail.com"]["usageCount"], 1)

    def test_uninvited_account_cannot_interpret(self):
        status, data = self._request("/interpret", {"text": "hola"}, email="colado@gmail.com")
        self.assertEqual(status, "401 Unauthorized")
        self.assertEqual(data.get("code"), "account_not_allowed")



class GoogleIntegrationsAreOwnerOnlyTests(unittest.TestCase):
    """PRIVACIDAD: Calendar, Contactos y Drive usan UNA autorización (la del
    propietario). Un invitado no debe poder leer ni escribir en ellas, ni
    sustituirla al «conectar»."""

    def setUp(self):
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ.pop("K_SERVICE", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = OWNER
        self.store = {"ana@gmail.com": {"status": "active", "mode": "open"}}

    def tearDown(self):
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)
        app.set_test_dependencies()

    def request(self, path, payload, email):
        app.set_test_dependencies(verifier=lambda token: claims(email), access_factory=lambda: AccessControl(store=self.store))
        body = json.dumps(payload).encode("utf-8")
        captured = {}
        raw = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": "Bearer t"}, lambda status, headers: captured.setdefault("status", status)))
        return captured["status"], json.loads(raw) if raw.strip().startswith(b"{") else {}

    def test_invitee_cannot_use_calendar_contacts_or_drive(self):
        for path, payload in [
            ("/google", {"integration": "calendar", "action": "list", "params": {}}),
            ("/google", {"integration": "contacts", "action": "search", "query": "Ana"}),
            ("/oauth/exchange", {"integration": "calendar", "code": "x", "redirectUri": "https://example.com"}),
            ("/media/delete", {"fileId": "abcdefghijklmno"}),
            ("/media/download", {"fileId": "abcdefghijklmno"}),
        ]:
            status, data = self.request(path, payload, "ana@gmail.com")
            self.assertEqual(status, "403 Forbidden", path)
            self.assertEqual(data["code"], "owner_only_integration", path)

    def test_invitee_session_status_does_not_reveal_owner_connections(self):
        status, data = self.request("/session/status", {}, "ana@gmail.com")
        self.assertEqual(status, "200 OK")
        for integration in ("contacts", "calendar", "drive"):
            self.assertEqual(data[integration]["reason"], "owner_only")

    def test_owner_is_not_blocked(self):
        status, _ = self.request("/google", {"integration": "nope", "action": "list"}, OWNER)
        self.assertNotEqual(status, "403 Forbidden")


if __name__ == "__main__":
    unittest.main()
