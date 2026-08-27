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

        P01/P02 y P12 requieren además el coordinador de conversación,
        Firestore y/o una notificación en dispositivo. Se registran como
        pendientes manuales de esta primera fase; nunca se simulan como éxito.
        """
        try:
            self._run("P03-complete", self._complete_reminder)
            self._run("P03-external", self._external_calendar_delete)
            self._run("P04", self._calendar_cancel)
            self._run("P04-name", self._calendar_cancel_by_name)
            self._run("P10", self._calendar_query)
            self._run("P11", self._calendar_update)
            self._run("P05-summary", self._reminder_summary)
            self._run("P05-description", self._calendar_descriptions)
            self._run("P05-relative", self._relative_reminders)
            self._run("P05-model-time", self._model_time_reminder)
            self._run("P05-linked", self._linked_event_and_reminder)
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

    def _complete_reminder(self) -> None:
        """P03: completar un recordatorio retira su aviso real de Calendar."""
        now = datetime.now(timezone.utc)
        title = f"{self.prefix} Llamar a Miguel"
        event = self._create_event(title, now + timedelta(hours=2), now + timedelta(hours=3))
        self.service.api(CALENDAR, "DELETE", self._calendar_base() + "/" + event["id"])
        self.created_events.remove(event["id"])
        listed = self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + urlencode({
            "singleEvents": "true", "q": title,
            "timeMin": now.isoformat(), "timeMax": (now + timedelta(days=1)).isoformat(),
        }))
        active_ids = {item.get("id") for item in listed.get("items", [])
            if isinstance(item, dict) and item.get("status") != "cancelled"}
        if event["id"] in active_ids:
            raise RuntimeError("El recordatorio completado continúa activo en Calendar")

    def _external_calendar_delete(self) -> None:
        """Un borrado externo queda observable como ausencia, no como evento activo."""
        now = datetime.now(timezone.utc)
        event = self._create_event(f"{self.prefix} Aviso externo", now + timedelta(hours=2), now + timedelta(hours=3))
        event_id = event["id"]
        self.service.api(CALENDAR, "DELETE", self._calendar_base() + "/" + event_id)
        self.created_events.remove(event_id)
        try:
            deleted = self.service.api(CALENDAR, "GET", self._calendar_base() + "/" + event_id)
        except Exception as error:
            if getattr(error, "code", None) in {404, 410}:
                return
            raise
        if deleted.get("status") == "cancelled":
            return
        raise RuntimeError("Calendar sigue devolviendo como activo el aviso borrado externamente")

    def _calendar_cancel_by_name(self) -> None:
        """Busca por persona aunque la categoría dictada y el título sean sinónimos."""
        fixture = Path(__file__).resolve().parents[1] / "tests/cancel-search-fixture.mjs"
        search = json.loads(subprocess.run(["node", str(fixture), "", "Anula cita con Miguel"], check=True,
            capture_output=True, text=True, timeout=20).stdout)
        if search["query"] != "Miguel":
            raise RuntimeError("La búsqueda no utiliza la persona de la cita")
        now = datetime.now(timezone.utc)
        events = [self._create_event(f"{self.prefix} Quedada con Miguel {i}",
            now + timedelta(days=i+1), now + timedelta(days=i+1, hours=1)) for i in range(3)]
        # Solo el espacio de pruebas; no añade fechas suministradas por el usuario.
        url = self._calendar_base() + "?" + search["params"]
        found = self.service.api(CALENDAR, "GET", url)
        expected = {item["id"] for item in events}
        if not expected.issubset({item["id"] for item in found.get("items", [])}):
            raise RuntimeError("'Anula cita con Miguel' no encontró las quedadas por persona")
        selected = events[1]["id"]
        self.service.api(CALENDAR, "DELETE", self._calendar_base() + "/" + selected)
        self.created_events.remove(selected)
        remaining = {item["id"] for item in self.service.api(CALENDAR, "GET", url).get("items", [])
            if item.get("status") != "cancelled"}
        if selected in remaining or not (expected - {selected}).issubset(remaining):
            raise RuntimeError("La cancelación no conservó las otras dos llamadas")
        later = (now + timedelta(days=120)).replace(hour=10, minute=0, second=0, microsecond=0)
        distant = self._create_event(f"{self.prefix} Quedada con Miguel lejana", later, later + timedelta(hours=1))
        dated = json.loads(subprocess.run(["node", str(fixture), later.date().isoformat(), "Anula cita con Miguel"],
            check=True, capture_output=True, text=True, timeout=20).stdout)
        found_later = self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + dated["params"])
        if distant["id"] not in {item["id"] for item in found_later.get("items", [])}:
            raise RuntimeError("La búsqueda por fecha no recupera una llamada a más de 90 días")

    def _calendar_query(self) -> None:
        """P10: fuerza dos páginas reales de un día y comprueba ambos eventos."""
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        expected = [f"{self.prefix} Agenda A", f"{self.prefix} Agenda B"]
        for index, title in enumerate(expected):
            self._create_event(title, tomorrow + timedelta(hours=index * 2), tomorrow + timedelta(hours=index * 2 + 1))
        params = {
            "singleEvents": "true", "orderBy": "startTime", "maxResults": "1",
            "timeMin": tomorrow.replace(hour=0).isoformat(),
            "timeMax": (tomorrow + timedelta(days=1)).replace(hour=0).isoformat(),
        }
        pages = [self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + urlencode(params))]
        token = pages[0].get("nextPageToken")
        if not isinstance(token, str) or not token:
            raise RuntimeError("Calendar no entregó el token de la segunda página")
        while token:
            pages.append(self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + urlencode({**params, "pageToken": token})))
            token = pages[-1].get("nextPageToken")
            if len(pages) > 50:
                raise RuntimeError("Calendar no terminó la paginación de prueba")
        found = {item.get("summary") for page in pages for item in page.get("items", []) if isinstance(item, dict)}
        missing = [title for title in expected if title not in found]
        if missing:
            raise RuntimeError("Calendar no devolvió los eventos de prueba: " + ", ".join(missing))

    def _calendar_update(self) -> None:
        """P11: una frase de cambio busca por la persona, no por «hora con»."""
        start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
        title = f"{self.prefix} Quedada con María"
        event = self._create_event(title, start, start + timedelta(hours=1))
        fixture = Path(__file__).resolve().parents[1] / "tests/calendar-update-search-fixture.mjs"
        search = json.loads(subprocess.run(
            ["node", str(fixture), "Cámbiame la hora con María", "hora con María"],
            check=True, capture_output=True, text=True, timeout=20,
        ).stdout)
        if search["query"] != "María":
            raise RuntimeError("La modificación buscó el campo hora en vez de la persona María")
        listed = self.service.api(CALENDAR, "GET", self._calendar_base() + "?" + urlencode({
            "singleEvents": "true", "orderBy": "startTime", "q": search["query"],
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
        if saved.get("description", "") != payload.get("description", ""):
            raise RuntimeError("Calendar no conserva la descripción confirmada")

    def _calendar_descriptions(self) -> None:
        """Firestore PWA → payload PWA → Calendar real para evento y aviso."""
        fixture = Path(__file__).resolve().parents[1] / "tests" / "calendar-description-fixture.mjs"
        cases = json.loads(subprocess.run(["node", str(fixture)], check=True,
            capture_output=True, text=True, timeout=20).stdout)
        for case in cases:
            payload = case["event"]
            payload["summary"] = f"{self.prefix} {payload['summary']}"
            created = self.service.api(CALENDAR, "POST", self._calendar_base(), payload)
            event_id = created.get("id")
            if not event_id:
                raise RuntimeError(f"Calendar no devolvió el ID de {case['kind']}")
            self.created_events.append(event_id)
            saved = self.service.api(CALENDAR, "GET", self._calendar_base() + "/" + event_id)
            if saved.get("description", "") != case["expected"]:
                raise RuntimeError(f"Calendar perdió la descripción de {case['kind']}")

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

    def _model_time_reminder(self) -> None:
        from app import validate_interpretation
        root = Path(__file__).resolve().parents[1]
        sample = json.loads((root / "tests/fixtures/gemini-zero-seconds.json").read_text())
        interpreted = validate_interpretation(sample["raw"])
        if interpreted["time"] != "10:00":
            raise RuntimeError("La hora de Gemini no se normalizó a HH:MM")
        payload = json.loads(subprocess.run(["node", str(root / "tests/model-reminder-payload.mjs")],
            input=json.dumps({"text": sample["text"], "interpretation": interpreted}),
            check=True, capture_output=True, text=True, timeout=20).stdout)
        payload["summary"] = f"{self.prefix} {payload['summary']}"
        event = self.service.api(CALENDAR, "POST", self._calendar_base(), payload)
        self.created_events.append(event["id"])
        saved = self.service.api(CALENDAR, "GET", self._calendar_base() + "/" + event["id"])
        actual = datetime.fromisoformat(saved["start"]["dateTime"].replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Madrid"))
        if actual.strftime("%Y-%m-%dT%H:%M:%S") != "2026-08-27T10:00:00" or "Miguel Ibiza" not in saved.get("summary", ""):
            raise RuntimeError("Calendar no conservó la hora y el contacto de la muestra Gemini")

    def _linked_event_and_reminder(self) -> None:
        """P05: una frase crea un evento y un aviso anterior relacionados."""
        fixture = Path(__file__).resolve().parents[1] / "tests" / "p05-linked-fixture.mjs"
        case = json.loads(subprocess.run(["node", str(fixture)], check=True,
            capture_output=True, text=True, timeout=20).stdout)
        if case["interpretation"]["linkedReminder"]["date"] != "2026-09-12":
            raise RuntimeError("P05 no calculó el aviso dos días antes")
        if "San Marcos de Gandía" not in (case["interpretation"].get("location") or ""):
            raise RuntimeError("P05 no separó la ubicación del título")
        event_payload = case["event"]
        # La fixture usa IDs estables para las pruebas locales, pero Calendar
        # no permite reutilizar un ID después de borrar el evento. En la prueba
        # real Google debe generar IDs nuevos para que el arnés sea repetible.
        event_payload.pop("id", None)
        event_payload["summary"] = f"{self.prefix} {event_payload['summary']}"
        event = self.service.api(CALENDAR, "POST", self._calendar_base(), event_payload)
        self.created_events.append(event["id"])
        reminder_payload = case["reminder"]
        reminder_payload.pop("id", None)
        reminder_payload["summary"] = f"{self.prefix} {reminder_payload['summary']}"
        reminder_payload["extendedProperties"] = {"private": {"angeliRelatedEventId": event["id"]}}
        reminder = self.service.api(CALENDAR, "POST", self._calendar_base(), reminder_payload)
        self.created_events.append(reminder["id"])
        saved_event = self.service.api(CALENDAR, "GET", self._calendar_base() + "/" + event["id"])
        saved_reminder = self.service.api(CALENDAR, "GET", self._calendar_base() + "/" + reminder["id"])
        relation = saved_reminder.get("extendedProperties", {}).get("private", {}).get("angeliRelatedEventId")
        if "Boda" not in saved_event.get("summary", "") or "Comprobar el equipo" not in saved_reminder.get("summary", ""):
            raise RuntimeError("Calendar no conservó los dos elementos de P05")
        if "San Marcos de Gandía" not in saved_event.get("location", "") or "San Marcos de Gandía" not in saved_reminder.get("summary", ""):
            raise RuntimeError("P05 perdió la ubicación o el contexto del aviso en Calendar")
        if relation != event["id"]:
            raise RuntimeError("El aviso de P05 no quedó vinculado con su evento")
        related_url = self._calendar_base() + "?" + urlencode({
            "singleEvents": "true", "maxResults": "20",
            "privateExtendedProperty": f"angeliRelatedEventId={event['id']}"
        })
        related = self.service.api(CALENDAR, "GET", related_url).get("items", [])
        if [item.get("id") for item in related] != [reminder["id"]]:
            raise RuntimeError("P05 no localizó exclusivamente el aviso asociado")
        self.service.api(CALENDAR, "DELETE", self._calendar_base() + "/" + event["id"])
        self.service.api(CALENDAR, "DELETE", self._calendar_base() + "/" + reminder["id"])
        if self.service.api(CALENDAR, "GET", related_url).get("items"):
            raise RuntimeError("P05 dejó activo el aviso después de cancelar la boda")
        self.created_events.remove(event["id"])
        self.created_events.remove(reminder["id"])

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
            "manualCases": ["P07", "P08", "P09", "P12", "P13", "P14", "P15", "P16"],
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
