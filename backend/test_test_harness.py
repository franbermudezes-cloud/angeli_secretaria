import os
import unittest
from datetime import datetime, timezone

from test_harness import HarnessConfigurationError, IntegrationHarness, configured_harness


class FakeGoogleSessions:
    def __init__(self):
        self.events = {}
        self.deleted_files = []
        self.next_id = 0

    def api(self, integration, method, url, body=None):
        if method == "POST":
            self.next_id += 1
            event_id = f"event-{self.next_id}"
            self.events[event_id] = body
            return {"id": event_id}
        if method == "GET":
            event_id = url.rsplit("/", 1)[-1]
            if event_id in self.events:
                return {"id": event_id, **self.events[event_id]}
            return {"items": [{"id": event_id, "summary": event["summary"]} for event_id, event in self.events.items()]}
        if method == "PATCH":
            event_id = url.rsplit("/", 1)[-1]
            self.events[event_id].update(body)
            return {"id": event_id, **self.events[event_id]}
        if method == "DELETE":
            self.events.pop(url.rsplit("/", 1)[-1], None)
            return {}
        raise AssertionError(method)

    def upload_drive_file(self, data, name, mime_type, kind):
        return {"driveFileId": "file-1", "name": name}

    def delete_drive_file(self, file_id):
        self.deleted_files.append(file_id)


class TestHarnessTests(unittest.TestCase):
    def setUp(self):
        self.previous = {
            key: os.environ.get(key)
            for key in (
                "ANGELI_TEST_MODE",
                "GOOGLE_CLOUD_PROJECT",
                "GOOGLE_WEB_CLIENT_ID",
                "ANGELI_TEST_GOOGLE_WEB_CLIENT_ID",
            )
        }

    def tearDown(self):
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_refuses_to_run_without_explicit_test_mode(self):
        os.environ.pop("ANGELI_TEST_MODE", None)
        with self.assertRaises(HarnessConfigurationError):
            configured_harness()

    def test_requires_dedicated_test_client_id_and_never_falls_back_to_production(self):
        os.environ["ANGELI_TEST_MODE"] = "1"
        os.environ["GOOGLE_CLOUD_PROJECT"] = "angeli-secretaria"
        os.environ["GOOGLE_WEB_CLIENT_ID"] = "production-client-id"
        os.environ.pop("ANGELI_TEST_GOOGLE_WEB_CLIENT_ID", None)
        with self.assertRaises(HarnessConfigurationError):
            configured_harness()

        os.environ["ANGELI_TEST_GOOGLE_WEB_CLIENT_ID"] = "test-client-id"
        harness = configured_harness()
        self.assertEqual(harness.service.client_id, "test-client-id")

    def test_test_profile_uses_only_test_oauth_secret(self):
        service = FakeGoogleSessions()
        session = __import__("google_sessions").GoogleSessions(
            "angeli-secretaria", "client-id", grant_prefix="angeli-test-google"
        )
        requested = []
        session._read_secret = lambda name: requested.append(name) or "test-secret"
        self.assertEqual(session._oauth_secret(), "test-secret")
        self.assertEqual(requested, ["angeli-test-google-oauth-client-secret"])

    def test_calendar_cases_use_and_remove_only_generated_events(self):
        service = FakeGoogleSessions()
        harness = IntegrationHarness(service, prefix="ANGELI-TEST-unit")
        harness._calendar_cancel()
        harness._calendar_query()
        harness._calendar_update()
        harness.cleanup()
        self.assertEqual(service.events, {})

    def test_reminder_payload_uses_pwa_constructor_and_cleans_up(self):
        service = FakeGoogleSessions()
        harness = IntegrationHarness(service, prefix="ANGELI-TEST-unit")
        try:
            harness._reminder_summary()
            event = next(iter(service.events.values()))
            self.assertEqual(event["summary"], "ANGELI-TEST-unit Llamar a Miguel Ibiza")
        finally:
            harness.cleanup()
        self.assertEqual(service.events, {})

    def test_drive_case_removes_generated_file_and_restores_environment(self):
        service = FakeGoogleSessions()
        harness = IntegrationHarness(service, prefix="ANGELI-TEST-unit")
        before = (os.environ.get("ANGELI_DRIVE_IMAGES_FOLDER_ID"), os.environ.get("ANGELI_DRIVE_FILES_FOLDER_ID"))
        harness._drive_upload_and_cleanup()
        harness.cleanup()
        self.assertEqual(service.deleted_files, ["file-1"])
        self.assertEqual((os.environ.get("ANGELI_DRIVE_IMAGES_FOLDER_ID"), os.environ.get("ANGELI_DRIVE_FILES_FOLDER_ID")), before)

    def test_reminder_case_fails_if_calendar_loses_the_title(self):
        service = FakeGoogleSessions()
        original_api = service.api
        def broken_api(integration, method, url, body=None):
            result = original_api(integration, method, url, body)
            return {**result, "summary": "Llamar a contacto"} if method == "GET" else result
        service.api = broken_api
        harness = IntegrationHarness(service, prefix="ANGELI-TEST-unit")
        try:
            with self.assertRaisesRegex(RuntimeError, "summary"):
                harness._reminder_summary()
        finally:
            harness.cleanup()
        self.assertEqual(service.events, {})


if __name__ == "__main__":
    unittest.main()
