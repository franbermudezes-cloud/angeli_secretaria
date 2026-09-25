"""3ª auditoría: el intérprete rechazaba respuestas correctas por detalles de
formato, trabajaba con la hora en UTC y sin día de la semana, y cobraba cupo en
rutas que no usan IA o que fallaban. Cada caso aquí es un hallazgo real."""

import json
import os
import unittest
from io import BytesIO
from pathlib import Path

import app
from access_control import AccessControl, current_period


def base(**fields):
    raw = {"intent": "note", "confidence": 0.9}
    raw.update(fields)
    return raw


class LenientValidationTests(unittest.TestCase):
    def test_target_without_time_is_accepted(self):
        # «Cancela la cena con Vicente»: sin hora dicha.
        result = app.validate_interpretation(base(intent="calendar.delete", target={"title": "Vicente", "date": None, "time": None}))
        self.assertIsNone(result["target"]["time"])
        result = app.validate_interpretation(base(intent="task.complete", target={"title": "Miguel", "date": "", "time": ""}))
        self.assertIsNone(result["target"]["date"])
        self.assertIsNone(result["target"]["time"])

    def test_schema_allows_null_target_time(self):
        target = app.RESPONSE_SCHEMA["properties"]["target"]["anyOf"][1]["properties"]["time"]
        self.assertEqual(target["type"], ["string", "null"])

    def test_hours_without_leading_zero_or_with_seconds_are_normalized(self):
        self.assertEqual(app.validate_interpretation(base(intent="reminder.create", date="2026-09-26", time="9:00"))["time"], "09:00")
        self.assertEqual(app.validate_interpretation(base(intent="reminder.create", date="2026-09-26", time="21:30:00"))["time"], "21:30")
        changes = app.validate_interpretation(base(intent="calendar.update", target={"title": "cena", "date": None, "time": None}, changes={"time": "9:30"}))["changes"]
        self.assertEqual(changes["time"], "09:30")

    def test_same_day_range_becomes_one_day(self):
        result = app.validate_interpretation(base(intent="calendar.query", rangeStart="2026-09-25", rangeEnd="2026-09-25"))
        self.assertEqual(result["rangeEnd"], "2026-09-26")

    def test_empty_changes_and_unknown_missing_fields_do_not_reject_everything(self):
        result = app.validate_interpretation(base(intent="calendar.update", target={"title": "Miguel", "date": None, "time": None}, changes={}, missingFields=["time", "message", "question"], question="¿A qué hora?"))
        self.assertIsNone(result["changes"])
        self.assertEqual(result["missingFields"], ["time"])

    def test_invalid_linked_reminder_is_dropped_not_fatal(self):
        result = app.validate_interpretation(base(intent="calendar.create", title="Boda", date="2026-10-14", time="18:00", linkedReminder={"title": "", "date": "", "time": "", "notes": None}))
        self.assertIsNone(result["linkedReminder"])

    def test_note_scope_label_is_turned_into_its_id(self):
        classification = {"scope": "Empresa", "relationType": "Cliente", "relationName": "Oliva", "purpose": None, "tags": ["", "presupuesto"]}
        result = app.validate_interpretation(base(intent="note", title="Presupuesto", noteClassification=classification))
        self.assertEqual(result["noteClassification"]["scope"], "empresa")
        self.assertEqual(result["noteClassification"]["relationType"], "cliente")
        self.assertEqual(result["noteClassification"]["tags"], ["presupuesto"])

    def test_note_and_reminder_queries_keep_their_range(self):
        result = app.validate_interpretation(base(intent="note.query", rangeStart="2026-09-24", rangeEnd="2026-09-25"))
        self.assertEqual(result["rangeStart"], "2026-09-24")
        result = app.validate_interpretation(base(intent="reminder.query", rangeStart="2026-09-28", rangeEnd="2026-10-05"))
        self.assertEqual(result["rangeEnd"], "2026-10-05")


class PromptTests(unittest.TestCase):
    def test_prompt_uses_local_time_weekday_and_a_calendar(self):
        prompt = app.interpreter_prompt("¿Qué tengo el jueves?", "2026-09-25T22:30:00Z", "Europe/Madrid", None)
        # 22:30 UTC es sábado 00:30 en Madrid: el día NO debe salir viernes.
        self.assertIn("sábado 2026-09-26 00:30", prompt)
        self.assertIn("jueves 2026-10-01", prompt)
        self.assertIn("OPERACIÓN PENDIENTE: ninguna", prompt)

    def test_note_settings_are_not_presented_as_a_pending_operation(self):
        context = {"noteSettings": {"scopes": [{"id": "personal", "label": "Personal"}], "relationTypes": []}}
        prompt = app.interpreter_prompt("Apunta el código del portal", "2026-09-25T10:00:00+02:00", "Europe/Madrid", context)
        self.assertIn("OPERACIÓN PENDIENTE: ninguna", prompt)
        self.assertIn("AJUSTES DE NOTAS: {", prompt)
        pending = dict(context, interactionId="abc", intent="reminder.create", status="awaiting_input")
        prompt = app.interpreter_prompt("a las 10", "2026-09-25T10:00:00+02:00", "Europe/Madrid", pending)
        self.assertIn('OPERACIÓN PENDIENTE: {"interactionId": "abc"', prompt)
        self.assertNotIn('noteSettings', prompt.split("AJUSTES DE NOTAS")[0])

    def test_interpreter_runs_at_temperature_zero_with_room_for_long_notes(self):
        source = Path(app.__file__).read_text(encoding="utf-8")
        body = source.split("def vertex_interpret(", 1)[1].split("\ndef ", 1)[0]
        self.assertEqual(body.count("temperature=0"), 2)
        self.assertEqual(body.count("max_output_tokens=800"), 2)
        # Examen del intérprete: 2.5 Flash sin razonamiento es el que más acierta.
        self.assertEqual(app.INTERPRETER_MODEL, "gemini-2.5-flash")
        self.assertEqual(body.count("thinking_config=types.ThinkingConfig(thinking_budget=INTERPRETER_THINKING_BUDGET)"), 2)
        self.assertEqual(app.INTERPRETER_THINKING_BUDGET, 0)
        aside = source.split("def vertex_chat_aside(", 1)[1].split("\ndef ", 1)[0]
        self.assertIn("model=ASIDE_MODEL", aside, "la frase de reacción sigue en el modelo rápido")

    def test_single_day_query_date_becomes_a_one_day_range(self):
        # «¿Qué tengo mañana?»: Gemini daba `date` y la app buscaba 90 días.
        result = app.validate_interpretation(base(intent="calendar.query", date="2026-09-24"))
        self.assertEqual((result["rangeStart"], result["rangeEnd"]), ("2026-09-24", "2026-09-25"))

    def test_context_with_unknown_collected_fields_is_accepted(self):
        context = {"interactionId": "n1", "intent": "note", "status": "awaiting_input", "collectedData": {"title": "Nota", "noteQuery": None, "noteClassification": None}, "missingFields": [], "turns": []}
        self.assertEqual(app.validate_context(context)["collectedData"], {"title": "Nota"})


class QuotaChargingTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop("ANGELI_AI_DEV_BYPASS_AUTH", None)
        os.environ.pop("ALLOWED_FIREBASE_EMAILS", None)
        self.store = {"ana@gmail.com": {"status": "active", "mode": "trial", "monthlyLimit": 5}}

    def tearDown(self):
        app.set_test_dependencies()

    def request(self, path, payload, interpreter=None, search=None):
        app.set_test_dependencies(
            interpreter=interpreter or (lambda text, now, timezone: {"intent": "note", "confidence": 0.9}),
            verifier=lambda token: {"uid": "u1", "email": "ana@gmail.com", "email_verified": True},
            mercadona_search=search or (lambda query, limit: []),
            access_factory=lambda: AccessControl(store=self.store),
        )
        body = json.dumps(payload).encode()
        status = {}
        raw = b"".join(app.app({"REQUEST_METHOD": "POST", "PATH_INFO": path, "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": "Bearer t"}, lambda s, h: status.setdefault("s", s)))
        return status["s"], json.loads(raw)

    def used(self):
        record = self.store["ana@gmail.com"]
        return record.get("usageCount", 0) if record.get("usagePeriod") == current_period() else 0

    def test_successful_interpretation_consumes_one(self):
        status, _ = self.request("/interpret", {"text": "hola", "now": "2026-09-25T10:00:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "200 OK")
        self.assertEqual(self.used(), 1)

    def test_failed_or_invalid_requests_do_not_consume(self):
        def broken(text, now, timezone):
            raise RuntimeError("Vertex caído")
        self.request("/interpret", {"text": "hola", "now": "2026-09-25T10:00:00+02:00", "timeZone": "Europe/Madrid"}, interpreter=broken)
        self.request("/interpret", {"text": "hola"})  # mal formada
        self.assertEqual(self.used(), 0)

    def test_mercadona_search_does_not_consume(self):
        for _ in range(3):
            status, _ = self.request("/shopping/mercadona/search", {"query": "leche"})
            self.assertEqual(status, "200 OK")
        self.assertEqual(self.used(), 0)

    def test_exhausted_quota_still_blocks_interpretation(self):
        self.store["ana@gmail.com"].update({"usagePeriod": current_period(), "usageCount": 5})
        status, data = self.request("/interpret", {"text": "hola", "now": "2026-09-25T10:00:00+02:00", "timeZone": "Europe/Madrid"})
        self.assertEqual(status, "429 Too Many Requests")
        self.assertEqual(data["code"], "quota_exhausted")


if __name__ == "__main__":
    unittest.main()
