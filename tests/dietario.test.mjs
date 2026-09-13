import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dietarioEntries, groupDietarioByDay } from "../js/dietario.js";

const now = new Date("2026-09-15T09:00:00");

const notes = [
  { id: "cal1", type: "calendar", scheduledDate: "2026-09-15", scheduledTime: "10:00", calendarTitle: "Revisión con Laura", calendarStatus: "synced", location: "Oficina" },
  { id: "rem1", type: "reminder", status: "pending", schedule: { dueAt: "2026-09-15T12:30:00", status: "scheduled", action: { kind: "reminder" }, title: "Llamar al dentista" } },
  { id: "note1", type: "note", status: "pending", date: "2026-09-10T08:00:00", text: "Idea: renovar contrato", aiIntent: { title: "Renovar contrato" }, noteClassification: { scope: "casa", categoryLabel: "Casa" }, images: [{ id: "i1" }] },
  { id: "cal2", type: "calendar", scheduledDate: "2026-09-17", scheduledTime: "21:00", calendarTitle: "Cena con Marta", calendarStatus: "synced" },
  { id: "note2", type: "note", status: "pending", date: "2026-09-01T08:00:00", text: "Comprar regalo cumpleaños Ana" },
  { id: "note3", type: "note", status: "done", date: "2026-09-01T08:00:00", text: "Nota ya resuelta" },
  { id: "remCancelled", type: "reminder", status: "pending", schedule: { dueAt: "2026-09-15T08:00:00", status: "cancelled", action: { kind: "reminder" }, title: "Aviso cancelado" } },
  { id: "calFuture", type: "calendar", scheduledDate: "2026-09-30", scheduledTime: "09:00", calendarTitle: "Fuera de la semana", calendarStatus: "synced" }
];

const entries = dietarioEntries(notes);
assert.equal(entries.length, 6, "una nota hecha y un aviso cancelado no deben considerarse activos");
assert.ok(!entries.some(item => item.id === "remCancelled"));
assert.ok(!entries.some(item => item.id === "note3"), "una nota hecha no debe aparecer en el dietario");

const cal1 = entries.find(item => item.id === "cal1");
assert.equal(cal1.rail, "calendar");
assert.equal(cal1.title, "Revisión con Laura");
assert.equal(cal1.dateKey, "2026-09-15");
assert.equal(cal1.time, "10:00");

const rem1 = entries.find(item => item.id === "rem1");
assert.equal(rem1.rail, "reminder");
assert.equal(rem1.title, "Llamar al dentista");
assert.equal(rem1.dateKey, "2026-09-15");

const note1 = entries.find(item => item.id === "note1");
assert.equal(note1.rail, "note");
assert.equal(note1.dated, false, "una nota sin fecha programada va a la sección sin fecha");
assert.equal(note1.attachmentCount, 1);

const week = groupDietarioByDay(notes, { now, range: "week" });
assert.equal(week.days.length, 2, "solo los días dentro de la semana con elementos deben aparecer");
assert.equal(week.days[0].dateKey, "2026-09-15");
assert.equal(week.days[0].isToday, true);
assert.equal(week.days[0].items.length, 2);
assert.equal(week.days[0].items[0].id, "cal1", "los elementos de un día se ordenan por hora");
assert.equal(week.days[0].items[1].id, "rem1");
assert.ok(!week.days.some(day => day.dateKey === "2026-09-30"), "el rango semanal no incluye eventos fuera de la semana");
assert.equal(week.undated.length, 2);

const all = groupDietarioByDay(notes, { now, range: "all" });
assert.ok(all.days.some(day => day.dateKey === "2026-09-30"), "el rango 'todo' sí incluye eventos futuros lejanos");

const today = groupDietarioByDay(notes, { now, range: "today" });
assert.equal(today.days.length, 1);
assert.equal(today.days[0].items.length, 2);

const onlyCalendar = groupDietarioByDay(notes, { now, range: "all", type: "calendar" });
assert.ok(onlyCalendar.days.every(day => day.items.every(item => item.rail === "calendar")));
assert.equal(onlyCalendar.undated.length, 0, "el filtro por tipo también se aplica a la sección sin fecha");

const [html, app, serviceWorker, ui] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
  readFile(new URL("../js/ui.js", import.meta.url), "utf8")
]);
assert.match(html, /id="dietarioOpen"/);
assert.match(html, /id="dietarioLibrary"/);
assert.match(html, /id="dietarioList"/);
assert.match(html, /title="Calendario"/);
assert.match(app, /openDietario/);
assert.match(serviceWorker, /js\/dietario\.js/);
assert.match(ui, /groupDietarioByDay/);

console.log("dietario: ok");
