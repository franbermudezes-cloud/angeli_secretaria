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



class FakeSessions:
    """Sesiones de Google de mentira: recuerdan de QUIÉN son (su prefijo)."""

    def __init__(self, prefix, log):
        self.prefix, self.log = prefix, log

    def connection_status(self, integration):
        return {"state": "connected", "reason": self.prefix}

    def exchange_code(self, integration, code, redirect_uri):
        self.log.append(("exchange", self.prefix, integration))
        return {"connected": True}

    def api(self, integration, method, url, body=None):
        self.log.append(("api", self.prefix, integration))
        return {"items": [], "owner": self.prefix}

    def delete_drive_file(self, file_id):
        self.log.append(("delete", self.prefix, file_id))


class GooglePerPersonTests(unittest.TestCase):
    """PRIVACIDAD: cada persona usa SU Google (Calendar, Contactos y Drive).
    Un invitado nunca llega a las autorizaciones del propietario ni a las de
    otro invitado, y no puede elegirlas desde el móvil: salen del uid
    verificado."""

    def setUp(self):
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ.pop("K_SERVICE", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = OWNER
        os.environ["ALLOWED_ORIGINS"] = "https://example.com"
        self.store = {"ana@gmail.com": {"status": "active", "mode": "trial"}, "luis@gmail.com": {"status": "active", "mode": "open"}}
        self.log = []

    def tearDown(self):
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)
        os.environ.pop("ALLOWED_ORIGINS", None)
        app.set_test_dependencies()

    def request(self, path, payload, email, uid):
        app.set_test_dependencies(
            verifier=lambda token: claims(email, uid=uid),
            access_factory=lambda: AccessControl(store=self.store),
            session_factory=lambda: FakeSessions("angeli-google", self.log),
            guest_sessions_factory=lambda prefix: FakeSessions(prefix, self.log),
        )
        body = json.dumps(payload).encode("utf-8")
        captured = {}
        raw = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": "Bearer t"}, lambda status, headers: captured.setdefault("status", status)))
        return captured["status"], json.loads(raw) if raw.strip().startswith(b"{") else {}

    def test_each_guest_uses_their_own_google_never_the_owners(self):
        status, data = self.request("/google", {"integration": "calendar", "action": "list", "params": {}}, "ana@gmail.com", "uid-ana")
        self.assertEqual(status, "200 OK")
        ana = data["owner"]
        self.assertTrue(ana.startswith("angeli-google-u-"))
        _, luis = self.request("/google", {"integration": "contacts", "action": "search", "query": "Ana"}, "luis@gmail.com", "uid-luis")
        self.assertTrue(luis["owner"].startswith("angeli-google-u-"))
        self.assertNotEqual(ana, luis["owner"], "dos invitados no comparten llaves")
        _, owner = self.request("/google", {"integration": "calendar", "action": "list", "params": {}}, OWNER, "uid-owner")
        self.assertEqual(owner["owner"], "angeli-google")
        self.assertNotIn(("api", "angeli-google", "calendar"), self.log[:2], "los invitados nunca tocaron las llaves del propietario")

    def test_connecting_as_a_guest_never_replaces_the_owners_grant(self):
        status, _ = self.request("/oauth/exchange", {"integration": "calendar", "code": "x", "redirectUri": "https://example.com"}, "ana@gmail.com", "uid-ana")
        self.assertEqual(status, "200 OK")
        [(kind, prefix, integration)] = self.log
        self.assertEqual((kind, integration), ("exchange", "calendar"))
        self.assertEqual(prefix, app.guest_grant_prefix("uid-ana"))
        self.assertNotEqual(prefix, "angeli-google")

    def test_guest_drive_and_status_are_their_own(self):
        self.request("/media/delete", {"fileId": "abcdefghijklmno"}, "ana@gmail.com", "uid-ana")
        self.assertEqual(self.log, [("delete", app.guest_grant_prefix("uid-ana"), "abcdefghijklmno")])
        status, data = self.request("/session/status", {}, "ana@gmail.com", "uid-ana")
        self.assertEqual(status, "200 OK")
        for integration in ("contacts", "calendar", "drive"):
            self.assertEqual(data[integration]["reason"], app.guest_grant_prefix("uid-ana"))

    def test_prefix_comes_from_the_verified_uid_and_is_stable(self):
        self.assertEqual(app.guest_grant_prefix("uid-ana"), app.guest_grant_prefix("uid-ana"))
        self.assertNotEqual(app.guest_grant_prefix("uid-ana"), app.guest_grant_prefix("uid-luis"))
        self.assertNotIn("uid-ana", app.guest_grant_prefix("uid-ana"), "el nombre del secreto no revela el uid")
        with self.assertRaises(PermissionError):
            app.guest_grant_prefix("")

    def test_blocked_guest_cannot_use_google_at_all(self):
        self.store["ana@gmail.com"]["status"] = "blocked"
        status, _ = self.request("/google", {"integration": "calendar", "action": "list", "params": {}}, "ana@gmail.com", "uid-ana")
        self.assertEqual(status, "401 Unauthorized")
        self.assertEqual(self.log, [])

    def test_test_harness_stays_owner_only(self):
        os.environ["ANGELI_TEST_HARNESS_ENABLED"] = "1"
        try:
            status, data = self.request("/test/session/status", {}, "ana@gmail.com", "uid-ana")
        finally:
            os.environ.pop("ANGELI_TEST_HARNESS_ENABLED", None)
        self.assertEqual(status, "403 Forbidden")
        self.assertEqual(data["code"], "owner_only_integration")


class GuestSecretsTests(unittest.TestCase):
    """Solo se crean secretos de invitados; nunca del propietario ni del arnés."""

    class NotFound(Exception):
        pass

    def fake_client(self, existing):
        test = self
        class Client:
            def __init__(self):
                self.created = []
            def add_secret_version(self, request):
                name = request["parent"].rsplit("/", 1)[1]
                if name not in existing:
                    raise test.NotFound()
            def create_secret(self, request):
                self.created.append(request["secret_id"])
                existing.add(request["secret_id"])
        return Client()

    def session(self, prefix, client, **kwargs):
        from google_sessions import GoogleSessions
        service = GoogleSessions("p", "c", grant_prefix=prefix, **kwargs)
        service._client = lambda: client
        return service

    def test_guest_secret_is_created_on_first_connection(self):
        client = self.fake_client(set())
        prefix = app.guest_grant_prefix("uid-ana")
        self.session(prefix, client)._write_secret(f"{prefix}-calendar-grant", "{}")
        self.assertEqual(client.created, [f"{prefix}-calendar-grant"])

    def test_owner_or_harness_secret_is_never_created(self):
        for prefix in ("angeli-google", "angeli-test-google"):
            client = self.fake_client(set())
            with self.assertRaises(self.NotFound):
                self.session(prefix, client)._write_secret(f"{prefix}-calendar-grant", "{}")
            self.assertEqual(client.created, [])

    def test_personal_drive_folder_is_found_or_created_once(self):
        from google_sessions import GoogleSessions
        calls = []
        service = GoogleSessions("p", "c", grant_prefix=app.guest_grant_prefix("uid-ana"), personal_drive=True)
        def api(integration, method, url, body=None):
            calls.append(method)
            return {"files": []} if method == "GET" else {"id": "folder-1"}
        service.api = api
        self.assertEqual(service._drive_folder("image"), "folder-1")
        self.assertEqual(service._drive_folder("file"), "folder-1")
        self.assertEqual(calls, ["GET", "POST"], "busca, crea una vez y la recuerda")


if __name__ == "__main__":
    unittest.main()
