import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calendarAnswer, spokenWhen } from "../js/agenda.js";
import { buildCalendarSearch } from "../js/google.js";
import { findNoteMatches } from "../js/notes.js";

// Preguntar por tus cosas: «¿Cuándo es la cena con Vicente?», «¿Qué tengo
// mañana?», «¿Qué me dijo Luis del presupuesto?». Horas construidas en hora
// local para que no dependa de la zona de la máquina.
const now = new Date(2026, 8, 23, 10);
const at = (y, m, d, h, min = 0) => { const date = new Date(y, m - 1, d, h, min); return date.toISOString(); };

test("una pregunta sobre algo concreto busca por su tema en la agenda", () => {
  assert.equal(buildCalendarSearch({ intent: "calendar.query", target: { title: "la cena con Vicente" } }).query, "Vicente");
  assert.equal(buildCalendarSearch({ intent: "calendar.query", rangeStart: "2026-09-24", rangeEnd: "2026-09-25" }).query, "", "una pregunta de periodo no lleva texto");
});

test("respuesta directa en lenguaje natural", () => {
  assert.equal(spokenWhen({ start: at(2026, 9, 24, 17), allDay: false }, now), "mañana a las 17:00");
  assert.equal(spokenWhen({ start: at(2026, 9, 26, 21), allDay: false }, now), "el sábado 26 de septiembre a las 21:00");
  assert.equal(spokenWhen({ start: "2026-10-05", allDay: true }, now), "el lunes 5 de octubre, todo el día");
  assert.equal(calendarAnswer({ target: { title: "Vicente" } }, { events: [{ summary: "Cena con Vicente", start: at(2026, 9, 26, 21), location: "Casa Pepe" }] }, now),
    "«Cena con Vicente» es el sábado 26 de septiembre a las 21:00, en Casa Pepe.");
  assert.match(calendarAnswer({ target: { title: "dentista" } }, { events: [] }, now), /No encuentro nada sobre «dentista»/);
  assert.equal(calendarAnswer({ rangeStart: "2026-09-24" }, { events: [{ summary: "Dentista", start: at(2026, 9, 24, 17) }, { summary: "Cena", start: at(2026, 9, 24, 21) }] }, now),
    "Tienes 2 cosas: «Dentista» mañana a las 17:00 y «Cena» mañana a las 21:00.");
  assert.equal(calendarAnswer({ rangeStart: "2026-09-24" }, { events: [] }, now), "No tienes nada en ese periodo.");
});

test("la respuesta aparece arriba del resultado y se dice en voz alta en el modo conversación", () => {
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(ui, /const answer = intent === "calendar\.query" && result && !result\.error \? calendarAnswer\(note\.aiIntent \|\| \{\}, result\) : null;/);
  assert.match(app, /if\(kind==="manual"&&\$\("modalTitle"\)\.textContent==="Tu agenda"\)\{/);
});

test("notas: se encuentran aunque las palabras no vayan seguidas, sin inventar coincidencias", () => {
  const notes = [
    { type: "note", status: "pending", text: "Luis me comentó que el presupuesto sube a 3.000 €", date: "2026-09-20" },
    { type: "note", status: "pending", text: "Presupuesto de la cocina: 5.000", date: "2026-09-18" }
  ];
  assert.deepEqual(findNoteMatches(notes, { noteQuery: "Luis presupuesto" }).map(note => note.date), ["2026-09-20"]);
  assert.equal(findNoteMatches(notes, { noteQuery: "presupuesto" }).length, 2);
  assert.equal(findNoteMatches(notes, { noteQuery: "Luis coche" }).length, 0);
});
