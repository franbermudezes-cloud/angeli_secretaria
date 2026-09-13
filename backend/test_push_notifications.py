import unittest
from datetime import datetime, timezone
from types import ModuleType
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from push_notifications import PushNotifications


class QuietHoursTests(unittest.TestCase):
    def test_future_call_is_classified_from_schedule_action(self):
        entry = {"type": "reminder", "schedule": {"action": {"kind": "contact.call"}}}
        self.assertEqual(PushNotifications._entry_type(entry), "calls")

    def test_night_notice_moves_to_quiet_end(self):
        madrid = ZoneInfo("Europe/Madrid")
        moment = datetime(2026, 9, 12, 23, 15, tzinfo=madrid).astimezone(timezone.utc)
        result = PushNotifications._after_quiet_hours(moment, {"enabled": True, "start": "22:30", "end": "08:00", "deliverAfter": True})
        self.assertEqual(result.astimezone(madrid).isoformat(), "2026-09-13T08:00:00+02:00")

    def test_quiet_notice_can_be_discarded(self):
        madrid = ZoneInfo("Europe/Madrid")
        moment = datetime(2026, 9, 12, 7, 15, tzinfo=madrid).astimezone(timezone.utc)
        result = PushNotifications._after_quiet_hours(moment, {"enabled": True, "start": "22:30", "end": "08:00", "deliverAfter": False})
        self.assertIsNone(result)

    def test_day_notice_keeps_its_time(self):
        moment = datetime(2026, 9, 12, 10, 0, tzinfo=timezone.utc)
        result = PushNotifications._after_quiet_hours(moment, {"enabled": True, "start": "22:30", "end": "08:00", "deliverAfter": True})
        self.assertEqual(result, moment)


class DeliveryReliabilityTests(unittest.TestCase):
    def test_dated_pending_task_is_active_without_reminder_schedule(self):
        entry = {"type": "task", "status": "pending", "scheduledDate": "2026-09-13", "scheduledTime": "10:00"}
        self.assertTrue(PushNotifications._is_active_entry(entry))
        self.assertFalse(PushNotifications._is_active_entry(entry | {"status": "completed"}))

    def test_transient_send_error_does_not_consume_the_delivery(self):
        service = object.__new__(PushNotifications)
        reminder = MagicMock()
        reminder.get.return_value = MagicMock(exists=True)
        reminder.get.return_value.to_dict.return_value = {
            "dueAt": "2026-09-13T08:00:00+00:00", "generation": "g1",
            "tasks": [{"kind": "at", "name": "task-at"}],
        }
        entry_snapshot = MagicMock(exists=True)
        entry_snapshot.to_dict.return_value = {
            "type": "task", "status": "pending", "text": "Enviar informe",
            "scheduledDate": "2026-09-13", "scheduledTime": "10:00",
        }
        db = MagicMock()
        db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = entry_snapshot
        service._reminder_ref = MagicMock(return_value=reminder)
        service._db = MagicMock(return_value=db)
        service._send = MagicMock(side_effect=RuntimeError("FCM temporal"))

        with self.assertRaisesRegex(RuntimeError, "FCM temporal"):
            service.deliver("owner", "entry-1", "2026-09-13T08:00:00+00:00", "g1", "at")

        reminder.update.assert_not_called()
        reminder.delete.assert_not_called()

    def test_web_push_is_high_urgency_for_sleeping_mobile(self):
        service = object.__new__(PushNotifications)
        document = MagicMock()
        document.to_dict.return_value = {"token": "mobile-token"}
        db = MagicMock()
        db.collection.return_value.document.return_value.collection.return_value.stream.return_value = [document]
        service._db = MagicMock(return_value=db)

        messaging = MagicMock()
        messaging.WebpushConfig.return_value = "urgent-webpush"
        messaging.send_each.return_value = MagicMock(success_count=1, failure_count=0, responses=[MagicMock(success=True)])
        firebase_admin = ModuleType("firebase_admin")
        firebase_admin.messaging = messaging
        with patch.dict("sys.modules", {"firebase_admin": firebase_admin, "firebase_admin.messaging": messaging}), patch("push_notifications._firebase_app", return_value="firebase-app"):
            service._send("owner", "Aviso", "Es la hora", "entry-1", "./?reminder=entry-1")

        messaging.WebpushConfig.assert_called_once_with(headers={"Urgency": "high", "TTL": "86400"})
        self.assertEqual(messaging.Message.call_args.kwargs["webpush"], "urgent-webpush")


if __name__ == "__main__":
    unittest.main()
