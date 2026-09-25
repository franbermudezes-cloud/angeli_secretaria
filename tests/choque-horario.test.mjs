import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clashWarning } from "../js/agenda.js";
import { calendarClashes } from "../js/google.js";

// Aviso de choque: al preparar «Cena con Marta el jueves a las 21:00», si esa
// hora ya está ocupada, Angeli lo dice antes de confirmar.
const note = { id: "abc-123", proposal: { intent: "calendar.create" }, scheduledDate: "2026-10-01", scheduledTime: "21:00" };
const event = (id, summary, start, extra = {}) => ({ id, summary, status: "confirmed", start: { dateTime: start }, end: { dateTime: start }, ...extra });

test("cuenta lo que se pisa y descarta lo que no ocupa esa hora", () => {
  const clashes = calendarClashes([
    event("x1", "Dentista", "2026-10-01T21:00:00+02:00"),
    { id: "x2", summary: "Vacaciones", start: { date: "2026-10-01" }, end: { date: "2026-10-05" } },
    event("x3", "Borrado", "2026-10-01T21:15:00+02:00", { status: "cancelled" }),
    event("angeliabc123", "El propio evento (reintento)", "2026-10-01T21:00:00+02:00"),
    event("angelirem1", "Su aviso", "2026-10-01T20:30:00+02:00", { extendedProperties: { private: { angeliRelatedEventId: "angeliabc123" } } })
  ], note);
  assert.deepEqual(clashes.map(item => item.summary), ["Dentista"]);
});

test("el aviso suena natural para decirlo en voz alta", () => {
  assert.equal(clashWarning([]), "");
  assert.equal(clashWarning([{ summary: "Dentista", start: "2026-10-01T21:00:00+02:00" }]), "Oye, a esa hora ya tienes «Dentista» a las 21:00. ¿Lo apunto igual?");
  assert.equal(clashWarning([{ summary: "Pádel", start: "2026-10-01T20:30:00+02:00" }, { summary: "Dentista", start: "2026-10-01T21:00:00+02:00" }]), "Oye, a esa hora ya tienes 2 cosas: «Pádel» a las 20:30 y «Dentista» a las 21:00. ¿Lo apunto igual?");
});

test("la app comprueba la agenda antes de proponer el evento y muestra el aviso", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(app, /await google\.checkCalendarClash\(entry\)[\s\S]*?ui\.showEntryAction\(entry,google\)/);
  assert.equal((ui.match(/clashWarning\(google\?\.getClashResult\?\.\(note\)/g) || []).length, 2, "evento solo y evento con aviso");
});
