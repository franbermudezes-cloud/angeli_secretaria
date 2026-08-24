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
            return {"items": [{"id": event_id, "summary": event["summary"]} for event_id, event in self.events.items()]}
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
        self.previous = {key: os.environ.get(key) for key in ("ANGELI_TEST_MODE", "GOOGLE_CLOUD_PROJECT", "GOOGLE_WEB_CLIENT_ID")}

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

    def test_calendar_cases_use_and_remove_only_generated_events(self):
        service = FakeGoogleSessions()
        harness = IntegrationHarness(service, prefix="ANGELI-TEST-unit")
        harness._calendar_cancel()
        harness._calendar_query()
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


if __name__ == "__main__":
    unittest.main()
