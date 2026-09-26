import unittest
from datetime import datetime, timedelta, timezone
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


class FarAndRepeatedRemindersTests(unittest.TestCase):
    """Vistos en el registro real: avisos a más de 30 días (Cloud Tasks da 400)
    y avisos que ya estaban programados igual (409) fallaban con 503."""

    def service(self, due):
        service = object.__new__(PushNotifications)
        service.project, service.location, service.queue = "p", "l", "q"
        client = MagicMock()
        client.queue_path.return_value = "queue"
        client.task_path.side_effect = lambda *parts: "/".join(parts)
        service._tasks = MagicMock(return_value=client)
        reminder = MagicMock()
        reminder.get.return_value = MagicMock(exists=False)
        service._reminder_ref = MagicMock(return_value=reminder)
        entry = MagicMock(exists=True)
        entry.to_dict.return_value = {"type": "reminder", "schedule": {"status": "scheduled"}}
        db = MagicMock()
        db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = entry
        service._db = MagicMock(return_value=db)
        service._settings = MagicMock(return_value={"atTime": True, "beforeMinutes": 0, "afterMinutes": 60, "types": {"reminders": True}, "quiet": {"enabled": False}})
        service.created = []
        service._create_task = lambda client, parent, name, at, payload: service.created.append((payload["kind"], at))
        return service, reminder

    def test_far_reminder_is_deferred_instead_of_failing(self):
        due = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()
        service, reminder = self.service(due)
        result = service.schedule("uid", "entry", due)
        kinds = [kind for kind, _ in service.created]
        self.assertEqual(kinds, ["defer"], "nada a más de 30 días; solo el recordatorio para reprogramar")
        self.assertTrue(result["scheduled"])
        self.assertLess(service.created[0][1], datetime.now(timezone.utc) + timedelta(days=30))

    def test_near_reminder_is_scheduled_normally(self):
        due = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        service, _ = self.service(due)
        service.schedule("uid", "entry", due)
        self.assertEqual([kind for kind, _ in service.created], ["at", "after"])

    def test_defer_delivery_reschedules(self):
        service = object.__new__(PushNotifications)
        reminder = MagicMock()
        reminder.get.return_value = MagicMock(exists=True)
        reminder.get.return_value.to_dict.return_value = {"dueAt": "d", "generation": "g", "tasks": [{"kind": "defer", "name": "x"}]}
        service._reminder_ref = MagicMock(return_value=reminder)
        service.schedule = MagicMock(return_value={"scheduled": True})
        self.assertEqual(service.deliver("uid", "entry", "d", "g", "defer"), {"scheduled": True})
        service.schedule.assert_called_once_with("uid", "entry", "d")

    def test_already_existing_task_counts_as_scheduled(self):
        class AlreadyExists(Exception):
            code = 409
        class Other(Exception):
            code = 400
        self.assertTrue(PushNotifications._already_exists(AlreadyExists()))
        self.assertFalse(PushNotifications._already_exists(Other()))


class NotFoundDetectionTests(unittest.TestCase):
    """Reprogramar un aviso cuya tarea ya sonó fallaba con TypeError: `code`
    es un valor en google-api-core y se llamaba como función."""

    def test_detects_not_found_in_every_shape(self):
        from push_notifications import PushNotifications
        class NotFound(Exception):
            code = 404
        class ApiCoreError(Exception):
            code = 404
        class Status:
            name = "NOT_FOUND"
        class GrpcError(Exception):
            def code(self):
                return Status()
        class Other(Exception):
            code = 500
        self.assertTrue(PushNotifications._not_found(NotFound()))
        self.assertTrue(PushNotifications._not_found(ApiCoreError()))
        self.assertTrue(PushNotifications._not_found(GrpcError()))
        self.assertFalse(PushNotifications._not_found(Other()))
        self.assertFalse(PushNotifications._not_found(RuntimeError("x")))


if __name__ == "__main__":
    unittest.main()
