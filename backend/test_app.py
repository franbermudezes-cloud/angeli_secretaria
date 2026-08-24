import os
import unittest
from io import BytesIO

import app


VALID_RESPONSE = {
    "intent": "calendar.create",
    "confidence": 0.96,
    "title": "Cena con Pedro",
    "date": "2026-08-21",
    "time": "21:00",
    "rangeStart": None,
    "rangeEnd": None,
    "location": None,
    "contactName": None,
    "phone": None,
    "notes": None,
    "target": None,
    "changes": None,
    "requiresConfirmation": True,
    "missingFields": [],
    "question": None,
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

    def test_accepts_partial_safe_model_response_and_normalizes_it(self):
        app.set_test_dependencies(lambda text, now, timezone: {"intent": "calendar.delete", "confidence": 0.91, "target": {"title": "Cena con Pedro"}})
        status, data = app.wsgi_request({"text": "Anula la cena", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["intent"], "calendar.delete")
        self.assertEqual(data["target"], {"title": "Cena con Pedro", "date": None, "time": None})
        self.assertTrue(data["requiresConfirmation"])

    def test_accepts_a_contextual_question_for_missing_time(self):
        app.set_test_dependencies(
            lambda text, now, timezone: {
                "intent": "reminder.create",
                "confidence": 0.93,
                "title": "Llamar a Pepe",
                "date": "2026-08-21",
                "missingFields": ["time"],
                "question": "¿A qué hora?",
            }
        )
        status, data = app.wsgi_request(
            {
                "text": "Mañana tengo que llamar a Pepe",
                "now": "2026-08-20T21:20:00+02:00",
                "timeZone": "Europe/Madrid",
                "context": {
                    "interactionId": "interaction-1",
                    "intent": "reminder.create",
                    "status": "awaiting_input",
                    "collectedData": {"title": "Llamar a Pepe", "date": "2026-08-21"},
                    "missingFields": ["time"],
                    "question": "¿A qué hora?",
                    "turns": [{"role": "user", "text": "Mañana tengo que llamar a Pepe"}],
                },
            }
        )
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["missingFields"], ["time"])
        self.assertEqual(data["question"], "¿A qué hora?")

    def test_preserves_structured_calendar_title_and_location(self):
        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE
            | {"title": "Discomóvil", "location": "Complejo San Marcos de Gandía"}
        )
        status, data = app.wsgi_request(
            {
                "text": "Está contratada discomóvil en Complejo San Marcos de Gandía el 29 de agosto a las siete de la tarde",
                "now": "2026-08-20T21:20:00+02:00",
                "timeZone": "Europe/Madrid",
            }
        )
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["title"], "Discomóvil")
        self.assertEqual(data["location"], "Complejo San Marcos de Gandía")

    def test_accepts_calendar_query_with_requested_date(self):
        app.set_test_dependencies(
            lambda text, now, timezone: {
                "intent": "calendar.query",
                "confidence": 0.92,
                "rangeStart": "2026-08-23",
                "rangeEnd": "2026-08-24",
            }
        )
        status, data = app.wsgi_request(
            {"text": "¿Qué tengo el domingo?", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"}
        )
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["intent"], "calendar.query")
        self.assertEqual(data["rangeStart"], "2026-08-23")
        self.assertEqual(data["rangeEnd"], "2026-08-24")
        self.assertIsNone(data["title"])

    def test_rejects_invalid_calendar_query_interval(self):
        app.set_test_dependencies(
            lambda text, now, timezone: {
                "intent": "calendar.query",
                "confidence": 0.92,
                "rangeStart": "2026-08-24",
                "rangeEnd": "2026-08-23",
            }
        )
        status, data = app.wsgi_request(
            {"text": "¿Qué tengo la semana que viene?", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"}
        )
        self.assertEqual(status, "503 Service Unavailable")
        self.assertEqual(data["error"], "Interpretación no disponible")

    def test_requires_confirmation_for_sensitive_intent(self):
        response = VALID_RESPONSE | {"intent": "calendar.delete", "target": {"title": "Cena con Pedro", "date": "2026-08-21", "time": None}, "requiresConfirmation": False}
        app.set_test_dependencies(lambda text, now, timezone: response)
        status, data = app.wsgi_request({"text": "Cancela la cena", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "200 OK")
        self.assertTrue(data["requiresConfirmation"])

    def test_accepts_scheduled_call_as_a_reminder_without_opening_a_call_intent(self):
        app.set_test_dependencies(
            lambda text, now, timezone: {
                "intent": "reminder.create",
                "confidence": 0.95,
                "title": "Llamar a Miguel Ibiza",
                "date": "2026-08-21",
                "time": "21:00",
                "contactName": "Miguel Ibiza",
            }
        )
        status, data = app.wsgi_request(
            {"text": "Llama a Miguel Ibiza mañana a las nueve", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"}
        )
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["intent"], "reminder.create")
        self.assertEqual(data["contactName"], "Miguel Ibiza")
        self.assertEqual(data["date"], "2026-08-21")
        self.assertEqual(data["time"], "21:00")

    def test_ignores_irrelevant_calendar_fields_on_a_reminder(self):
        app.set_test_dependencies(
            lambda text, now, timezone: {
                "intent": "reminder.create",
                "confidence": 0.93,
                "title": "Llamar a Monse",
                "date": "2026-08-22",
                "time": "13:00",
                "target": {"title": "Dato no aplicable", "date": None, "time": None},
                "changes": {"location": "Dato no aplicable"},
                "rangeStart": "2026-08-22",
                "rangeEnd": "2026-08-23",
            }
        )
        status, data = app.wsgi_request(
            {"text": "Recuérdame mañana a la una llamar a Monse", "now": "2026-08-21T14:00:00+02:00", "timeZone": "Europe/Madrid"}
        )
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["intent"], "reminder.create")
        self.assertIsNone(data["target"])
        self.assertIsNone(data["changes"])
        self.assertIsNone(data["rangeStart"])

    def test_rejects_unapproved_identity(self):
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "owner@example.com"
        app.set_test_dependencies(lambda text, now, timezone: VALID_RESPONSE.copy(), lambda token: {"uid": "other-sub", "email": "other@example.com", "email_verified": True})
        status, data = app.wsgi_request({"text": "Idea", "now": "2026-08-20T21:20:00+02:00", "timeZone": "Europe/Madrid"}, "Bearer test")
        self.assertEqual(status, "401 Unauthorized")
        self.assertEqual(data["error"], "No autorizado")
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)

    def test_preflight_is_empty_and_allows_authorized_origin(self):
        os.environ["ALLOWED_ORIGINS"] = "https://franbermudezes-cloud.github.io"
        captured = {}

        def start_response(status, headers):
            captured["status"], captured["headers"] = status, dict(headers)

        response = app.app({"REQUEST_METHOD": "OPTIONS", "PATH_INFO": "/interpret", "HTTP_ORIGIN": "https://franbermudezes-cloud.github.io", "wsgi.input": BytesIO()}, start_response)
        self.assertEqual(captured["status"], "204 No Content")
        self.assertEqual(captured["headers"]["Access-Control-Allow-Origin"], "https://franbermudezes-cloud.github.io")
        self.assertEqual(captured["headers"]["Content-Length"], "0")
        self.assertEqual(response, [])
        os.environ.pop("ALLOWED_ORIGINS", None)

    def test_persistent_contacts_are_read_only_and_calendar_actions_use_server_session(self):
        class FakeSessions:
            def __init__(self):
                self.calls = []

            def connected(self, integration):
                return integration in {"contacts", "calendar"}

            def api(self, integration, method, url, body=None):
                self.calls.append((integration, method, url, body))
                return {"results": []} if integration == "contacts" else {"id": "event-1"}

            def exchange_code(self, integration, code, redirect_uri):
                self.calls.append((integration, "exchange", code, redirect_uri))
                return {"connected": True}

        service = FakeSessions()
        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE.copy(),
            lambda token: {"uid": "approved-sub", "email": "owner@example.com", "email_verified": True},
            lambda: service,
        )
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "owner@example.com"
        status, data = request_path("/google", {"integration": "contacts", "action": "search", "query": "Montse"}, "Bearer test")
        self.assertEqual(status, "200 OK")
        self.assertEqual(data, {"results": []})
        self.assertEqual(service.calls[0][0:2], ("contacts", "GET"))
        self.assertIn("readMask=names%2CphoneNumbers", service.calls[0][2])
        status, data = request_path("/google", {"integration": "calendar", "action": "create", "event": {"summary": "Cena"}}, "Bearer test")
        self.assertEqual(status, "200 OK")
        self.assertEqual(data, {"calendarId": "primary", "id": "event-1"})
        self.assertEqual(service.calls[1][0:2], ("calendar", "POST"))
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)

    def test_calendar_read_and_write_use_the_same_primary_calendar(self):
        class FakeSessions:
            def __init__(self):
                self.calls = []

            def api(self, integration, method, url, body=None):
                self.calls.append((integration, method, url, body))
                return {"items": []} if method == "GET" else {"id": "event-1"}

        service = FakeSessions()
        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE.copy(),
            lambda token: {"uid": "approved-sub", "email": "owner@example.com", "email_verified": True},
            lambda: service,
        )
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "owner@example.com"
        status, created = request_path("/google", {"integration": "calendar", "action": "create", "event": {"summary": "Cena"}}, "Bearer test")
        self.assertEqual(status, "200 OK")
        self.assertEqual(created["calendarId"], "primary")
        status, listed = request_path("/google", {"integration": "calendar", "action": "list", "params": {"timeMin": "2026-08-25T00:00:00.000Z", "timeMax": "2026-08-26T00:00:00.000Z", "q": "Cena"}}, "Bearer test")
        self.assertEqual(status, "200 OK")
        self.assertEqual(listed["calendarId"], "primary")
        self.assertEqual(len(service.calls), 2)
        self.assertTrue(all("/calendars/primary/events" in call[2] for call in service.calls))
        self.assertIn("q=Cena", service.calls[1][2])
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)

    def test_calendar_failure_is_not_reported_as_an_empty_result(self):
        class FailingSessions:
            def api(self, integration, method, url, body=None):
                raise RuntimeError("upstream failed")

        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE.copy(),
            lambda token: {"uid": "approved-sub", "email": "owner@example.com", "email_verified": True},
            lambda: FailingSessions(),
        )
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "owner@example.com"
        status, data = request_path("/google", {"integration": "calendar", "action": "list", "params": {}}, "Bearer test")
        self.assertEqual(status, "502 Bad Gateway")
        self.assertEqual(data["error"], "Calendar no pudo completar la consulta")
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)

    def test_persistent_grant_body_is_read_once(self):
        class FakeSessions:
            def exchange_code(self, integration, code, redirect_uri):
                self.values = (integration, code, redirect_uri)
                return {"connected": True}

        service = FakeSessions()
        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE.copy(),
            lambda token: {"uid": "approved-sub", "email": "owner@example.com", "email_verified": True},
            lambda: service,
        )
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "owner@example.com"
        os.environ["ALLOWED_ORIGINS"] = "https://franbermudezes-cloud.github.io"
        status, data = request_path(
            "/oauth/exchange",
            {"integration": "contacts", "code": "one-code", "redirectUri": "https://franbermudezes-cloud.github.io"},
            "Bearer test",
            "https://franbermudezes-cloud.github.io",
        )
        self.assertEqual(status, "200 OK")
        self.assertEqual(data, {"connected": True})
        self.assertEqual(service.values, ("contacts", "one-code", "https://franbermudezes-cloud.github.io"))
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)
        os.environ.pop("ALLOWED_ORIGINS", None)

    def test_drive_upload_and_download_use_persistent_drive_grant(self):
        class FakeSessions:
            def upload_drive_file(self, data, name, mime_type, kind):
                self.upload = (data, name, mime_type, kind)
                return {"id": "drive-file-123", "driveFileId": "drive-file-123", "name": name, "type": mime_type, "size": len(data), "url": ""}

            def download_drive_file(self, file_id):
                self.download = file_id
                return b"test-file", "text/plain"

            def delete_drive_file(self, file_id):
                self.deleted = file_id

        service = FakeSessions()
        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE.copy(),
            lambda token: {"uid": "approved-sub", "email": "owner@example.com", "email_verified": True},
            lambda: service,
        )
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "owner@example.com"
        status, data = request_raw("/media/upload", b"photo", "Bearer test", {"HTTP_X_ANGELI_NAME": "foto.jpg", "HTTP_X_ANGELI_TYPE": "image/jpeg", "HTTP_X_ANGELI_KIND": "image"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(data["driveFileId"], "drive-file-123")
        self.assertEqual(service.upload, (b"photo", "foto.jpg", "image/jpeg", "image"))
        status, body = request_raw("/media/download", b'{"fileId":"drive-file-123"}', "Bearer test")
        self.assertEqual(status, "200 OK")
        self.assertEqual(body, b"test-file")
        status, data = request_path("/media/delete", {"fileId": "drive-file-123"}, "Bearer test")
        self.assertEqual(status, "200 OK")
        self.assertEqual(service.deleted, "drive-file-123")
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)

    def test_media_distinguishes_angeli_session_from_drive_access(self):
        class DriveDenied:
            def upload_drive_file(self, data, name, mime_type, kind):
                raise PermissionError("La autorización de Drive no puede escribir en la carpeta configurada")

        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ["ALLOWED_FIREBASE_EMAILS"] = "owner@example.com"
        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE.copy(),
            lambda token: {"uid": "approved-sub", "email": "owner@example.com", "email_verified": True},
            lambda: DriveDenied(),
        )
        extra = {"HTTP_X_ANGELI_NAME": "foto.jpg", "HTTP_X_ANGELI_TYPE": "image/jpeg", "HTTP_X_ANGELI_KIND": "image"}
        status, data = request_raw("/media/upload", b"photo", "Bearer test", extra)
        self.assertEqual(status, "401 Unauthorized")
        self.assertEqual(data["error"], "Drive no está autorizado para escribir en la carpeta configurada")
        app.set_test_dependencies(
            lambda text, now, timezone: VALID_RESPONSE.copy(),
            lambda token: {"uid": "other-sub", "email": "other@example.com", "email_verified": True},
        )
        status, data = request_raw("/media/upload", b"photo", "Bearer test", extra)
        self.assertEqual(status, "401 Unauthorized")
        self.assertEqual(data["error"], "La sesión de Angeli no está autorizada; inicia sesión de nuevo")
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)

    def test_drive_requires_fixed_destinations_and_never_creates_folders(self):
        from google_sessions import GoogleSessions

        os.environ["ANGELI_DRIVE_IMAGES_FOLDER_ID"] = "images-folder-id"
        os.environ["ANGELI_DRIVE_FILES_FOLDER_ID"] = "files-folder-id"
        service = GoogleSessions("angeli-secretaria", "client-id")
        self.assertTrue(service.drive_configured())
        service._read_secret = lambda name: "grant" if name == "angeli-google-drive-grant" else None
        self.assertTrue(service.connected("drive"))
        self.assertEqual(service._drive_folder("image"), "images-folder-id")
        self.assertEqual(service._drive_folder("file"), "files-folder-id")
        os.environ.pop("ANGELI_DRIVE_IMAGES_FOLDER_ID", None)
        os.environ.pop("ANGELI_DRIVE_FILES_FOLDER_ID", None)

    def test_test_profile_uses_different_secret_names_from_production(self):
        from google_sessions import GoogleSessions

        production = GoogleSessions("angeli-secretaria", "client-id")
        testing = GoogleSessions("angeli-secretaria", "client-id", grant_prefix="angeli-test-google")
        self.assertEqual(production._secret_name("calendar"), "angeli-google-calendar-grant")
        self.assertEqual(testing._secret_name("calendar"), "angeli-test-google-calendar-grant")
        self.assertNotEqual(production._secret_name("drive"), testing._secret_name("drive"))


def request_path(path, payload, authorization="", origin=""):
    body = __import__("json").dumps(payload).encode("utf-8")
    captured = {}

    def start_response(status, headers):
        captured["status"] = status

    response = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": authorization, "HTTP_ORIGIN": origin}, start_response))
    return captured["status"], __import__("json").loads(response)


def request_raw(path, body, authorization="", extra=None):
    captured = {}
    def start_response(status, headers): captured["status"] = status
    environ = {"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": authorization}
    environ.update(extra or {})
    response = b"".join(app.app(environ, start_response))
    try: return captured["status"], __import__("json").loads(response)
    except __import__("json").JSONDecodeError: return captured["status"], response


if __name__ == "__main__":
    unittest.main()
