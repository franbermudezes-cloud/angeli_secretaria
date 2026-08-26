"""Arnés de integración real, aislado de Angeli en producción.

No se ejecuta con ``unittest`` ni desde Cloud Run de producción. Este programa
actúa solamente si se invoca con ``ANGELI_TEST_MODE=1`` y utiliza los secretos
``angeli-test-google-*-grant``. Crea datos identificados con un prefijo único
y los elimina incluso cuando una comprobación falla.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from google_sessions import CALENDAR, GoogleSessions

TEST_GRANT_PREFIX = "angeli-test-google"
TEST_DRIVE_FOLDER_ID = "1A1iuK8xwn3icpNezmB2JeOvD8_fsKuEx"
REPORT_DIRECTORY = Path(__file__).with_name("test-reports")


class HarnessConfigurationError(RuntimeError):
    pass


@dataclass
class TestResult:
    case_id: str
    status: str
    detail: str = ""


@dataclass
class IntegrationHarness:
    service: GoogleSessions
    prefix: str = field(default_factory=lambda: f"ANGELI-TEST-{uuid.uuid4().hex[:10]}")
    created_events: list[str] = field(default_factory=list)
    created_drive_files: list[str] = field(default_factory=list)
    results: list[TestResult] = field(default_factory=list)

    def run(self) -> list[TestResult]:
        """Ejecuta las integraciones ya automatizables de P01–P16.

        P01/P02 y P05/P12 requieren además el coordinador de conversación,
        Firestore y/o una notificación en dispositivo. Se registran como
        pendientes manuales de esta primera fase; nunca se simulan como éxito.
        """
        try:
            self._run("P04", self._calendar_cancel)
            self._run("P10", self._calendar_query)
            self._run("P11", self._calendar_update)
            self._run("P05-summary", self._reminder_summary)
            self._run("P05-relative", self._relative_reminders)
            self._run("P06", self._drive_upload_and_cleanup)
        finally:
            self.cleanup()
            self._write_report()
        return self.results

    def _run(self, case_id: str, action) -> None:
        try:
            action()
            self.results.append(TestResult(case_id, "PASS"))
        except Exception as error:
            self.results.append(TestResult(case_id, "FAIL", str(error)))

    def _calendar_base(self) -> str:
        return "https://www.googleapis.com/calendar/v3/calendars/primary/events"

    def _create_event(self, title: str, start: datetime, end: datetime) -> dict[str, Any]:
        event = self.service.api(CALENDAR, "POST", self._calendar_base(), {
            "summary": title,
            "start": {"dateTime": start.isoformat(), "timeZone": "Europe/Madrid"},
            "end": {"dateTime": end.isoformat(), "timeZone": "Europe/Madrid"},
        })
        event_id = event.get("id")
        if not isinstance(event_id, str) or not event_id:
            raise RuntimeError("Calendar no devolvió el ID del evento de prueba")
        self.created_events.append(event_id)
        return event

    def _calendar_cancel(self) -> None:
        """P04: crea, encuentra y cancela un evento real de la cuenta de pruebas."""
        now = datetime.now(timezone.utc)
        title = f"{self.prefix} Cena con Carlos"
        event = self._create_event(title, now + timedelta(hours=2), now + timedelta(hours=3))
        listed = self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + urlencode({
            "singleEvents": "true", "orderBy": "startTime", "q": title,
            "timeMin": now.isoformat(), "timeMax": (now + timedelta(days=2)).isoformat(),
        }))
        ids = {item.get("id") for item in listed.get("items", []) if isinstance(item, dict)}
        if event["id"] not in ids:
            raise RuntimeError("Calendar creó el evento pero no lo recuperó en la misma agenda primaria")
        self.service.api(CALENDAR, "DELETE", self._calendar_base() + "/" + event["id"])
        self.created_events.remove(event["id"])

    def _calendar_query(self) -> None:
        """P10: consulta un día con dos eventos reales y comprueba ambos."""
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        expected = [f"{self.prefix} Agenda A", f"{self.prefix} Agenda B"]
        for index, title in enumerate(expected):
            self._create_event(title, tomorrow + timedelta(hours=index * 2), tomorrow + timedelta(hours=index * 2 + 1))
        listed = self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + urlencode({
            "singleEvents": "true", "orderBy": "startTime", "maxResults": "50",
            "timeMin": tomorrow.replace(hour=0).isoformat(),
            "timeMax": (tomorrow + timedelta(days=1)).replace(hour=0).isoformat(),
        }))
        found = {item.get("summary") for item in listed.get("items", []) if isinstance(item, dict)}
        missing = [title for title in expected if title not in found]
        if missing:
            raise RuntimeError("Calendar no devolvió los eventos de prueba: " + ", ".join(missing))

    def _calendar_update(self) -> None:
        """P11: localiza y cambia la hora de un evento en la agenda de pruebas."""
        start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
        title = f"{self.prefix} Reunión modificable"
        event = self._create_event(title, start, start + timedelta(hours=1))
        listed = self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + urlencode({
            "singleEvents": "true", "orderBy": "startTime", "q": title,
            "timeMin": (start - timedelta(hours=1)).isoformat(),
            "timeMax": (start + timedelta(days=1)).isoformat(),
        }))
        found = next((item for item in listed.get("items", []) if item.get("id") == event["id"]), None)
        if not found:
            raise RuntimeError("Calendar creó el evento pero no pudo localizarlo para modificarlo")
        updated_start = start + timedelta(hours=1)
        updated_end = updated_start + timedelta(hours=1)
        updated = self.service.api(CALENDAR, "PATCH", self._calendar_base() + "/" + event["id"], {
            "start": {"dateTime": updated_start.isoformat(), "timeZone": "Europe/Madrid"},
            "end": {"dateTime": updated_end.isoformat(), "timeZone": "Europe/Madrid"},
        })
        start_value = updated.get("start", {}).get("dateTime")
        if not isinstance(start_value, str):
            raise RuntimeError("Calendar no devolvió la nueva hora del evento actualizado")
        received = datetime.fromisoformat(start_value.replace("Z", "+00:00"))
        if received.astimezone(timezone.utc) != updated_start:
            raise RuntimeError("Calendar no guardó la hora actualizada del evento de prueba")

    def _reminder_summary(self) -> None:
        """Transcripción + IA parcial simulada → constructor PWA → Calendar real."""
        fixture = Path(__file__).resolve().parents[1] / "tests" / "reminder-event-fixture.mjs"
        payload = json.loads(subprocess.run(
            ["node", str(fixture), "--calendar-payload"],
            check=True, capture_output=True, text=True, timeout=20,
        ).stdout)
        if payload.get("summary") != "Llamar a Miguel Ibiza":
            raise RuntimeError("El constructor PWA perdió el nombre antes de enviar a Calendar")
        payload["summary"] = f"{self.prefix} {payload['summary']}"
        event = self.service.api(CALENDAR, "POST", self._calendar_base(), payload)
        event_id = event.get("id")
        if not event_id:
            raise RuntimeError("Calendar no devolvió el ID del recordatorio de prueba")
        self.created_events.append(event_id)
        saved = self.service.api(CALENDAR, "GET", self._calendar_base() + "/" + event_id)
        if saved.get("summary") != payload["summary"]:
            raise RuntimeError("El summary leído de Calendar no conserva Miguel Ibiza")
        if "Miguel Ibiza" not in saved.get("description", ""):
            raise RuntimeError("Calendar no conserva el dictado original en description")

    def _relative_reminders(self) -> None:
        fixture = Path(__file__).resolve().parents[1] / "tests" / "relative-reminder-fixture.mjs"
        cases = json.loads(subprocess.run(["node", str(fixture)], check=True,
            capture_output=True, text=True, timeout=20).stdout)
        for case in cases:
            payload = case["event"]
            payload["summary"] = f"{self.prefix} {payload['summary']}"
            event = self.service.api(CALENDAR, "POST", self._calendar_base(), payload)
            self.created_events.append(event["id"])
            saved = self.service.api(CALENDAR, "GET", self._calendar_base() + "/" + event["id"])
            actual = datetime.fromisoformat(saved["start"]["dateTime"].replace("Z", "+00:00"))
            actual = actual.astimezone(ZoneInfo("Europe/Madrid"))
            if actual.strftime("%Y-%m-%dT%H:%M") != case["expected"] + "T11:00":
                raise RuntimeError("Calendar no conservó la fecha relativa y hora esperadas")

    def _drive_upload_and_cleanup(self) -> None:
        """P06/P07 base: adjunto real a Drive de pruebas y eliminación posterior."""
        old_images = os.environ.get("ANGELI_DRIVE_IMAGES_FOLDER_ID")
        old_files = os.environ.get("ANGELI_DRIVE_FILES_FOLDER_ID")
        try:
            os.environ["ANGELI_DRIVE_IMAGES_FOLDER_ID"] = TEST_DRIVE_FOLDER_ID
            os.environ["ANGELI_DRIVE_FILES_FOLDER_ID"] = TEST_DRIVE_FOLDER_ID
            saved = self.service.upload_drive_file(b"ANGELI TEST - no conservar", f"{self.prefix}.txt", "text/plain", "file")
            file_id = saved.get("driveFileId")
            if not isinstance(file_id, str) or not file_id:
                raise RuntimeError("Drive no devolvió el ID del adjunto de prueba")
            self.created_drive_files.append(file_id)
        finally:
            if old_images is None:
                os.environ.pop("ANGELI_DRIVE_IMAGES_FOLDER_ID", None)
            else:
                os.environ["ANGELI_DRIVE_IMAGES_FOLDER_ID"] = old_images
            if old_files is None:
                os.environ.pop("ANGELI_DRIVE_FILES_FOLDER_ID", None)
            else:
                os.environ["ANGELI_DRIVE_FILES_FOLDER_ID"] = old_files

    def cleanup(self) -> None:
        for event_id in reversed(self.created_events):
            try:
                self.service.api(CALENDAR, "DELETE", self._calendar_base() + "/" + event_id)
            except Exception:
                pass
        self.created_events.clear()
        for file_id in reversed(self.created_drive_files):
            try:
                self.service.delete_drive_file(file_id)
            except Exception:
                pass
        self.created_drive_files.clear()

    def _write_report(self) -> None:
        REPORT_DIRECTORY.mkdir(exist_ok=True)
        report = {
            "runAt": datetime.now(timezone.utc).isoformat(), "prefix": self.prefix,
            "grantPrefix": TEST_GRANT_PREFIX,
            "results": [result.__dict__ for result in self.results],
            "automatedLocalCases": ["P01", "P02", "P03"],
            "manualCases": ["P05", "P07", "P08", "P09", "P12", "P13", "P14", "P15", "P16"],
        }
        (REPORT_DIRECTORY / f"{self.prefix}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def configured_harness() -> IntegrationHarness:
    if os.getenv("ANGELI_TEST_MODE") != "1":
        raise HarnessConfigurationError("Rechazo seguro: exporta ANGELI_TEST_MODE=1 para ejecutar pruebas reales")
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    client_id = os.getenv("ANGELI_TEST_GOOGLE_WEB_CLIENT_ID", "").strip()
    if not project or not client_id:
        raise HarnessConfigurationError("Faltan GOOGLE_CLOUD_PROJECT o ANGELI_TEST_GOOGLE_WEB_CLIENT_ID")
    return IntegrationHarness(GoogleSessions(project, client_id, grant_prefix=TEST_GRANT_PREFIX))


def main() -> int:
    try:
        results = configured_harness().run()
    except HarnessConfigurationError as error:
        print(f"CONFIGURACIÓN: {error}", file=sys.stderr)
        return 2
    for result in results:
        print(f"{result.case_id}: {result.status}{': ' + result.detail if result.detail else ''}")
    return 0 if all(result.status == "PASS" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
