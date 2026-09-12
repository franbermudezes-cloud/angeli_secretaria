import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from push_notifications import PushNotifications


class QuietHoursTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
