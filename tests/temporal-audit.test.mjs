import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanTemporalText, explicitRelativeDate, naturalQueryRange, temporalData } from "../js/temporal.js";
import { routeShortcutIntent } from "../js/shortcuts.js";
import { normalizeReminderSchedule } from "../js/schedule.js";

// 3ª auditoría (agente de fechas y horas): ~90 expresiones reales contra el
// parser local, que también COMPLETA respuestas de la IA. Fechas construidas
// con la hora local para que el resultado no dependa de la zona de la máquina.
const wed = new Date(2026, 8, 23, 10, 0); // miércoles 23/09/2026 10:00
const fri = new Date(2026, 8, 25, 10, 0); // viernes
const friNight = new Date(2026, 8, 25, 23, 30);
const at = (text, now, reminder = false) => {
  const data = temporalData(text, now, { inferDateFromTime: reminder });
  return [data.scheduledDate, data.scheduledTime].filter(Boolean).join(" ");
};

test("horas con minutos y franja: «y media», «menos cuarto», «y veinte», «de la noche», «9.30», «pm»", () => {
  assert.equal(at("a las 8 y media de la tarde", wed), "20:30");
  assert.equal(at("a las 9 y media de la noche", wed), "21:30");
  assert.equal(at("a las 12 y media", wed), "12:30");
  assert.equal(at("a las nueve y veinte", wed), "09:20");
  assert.equal(at("a las 7 menos cuarto de la mañana", wed), "06:45");
  assert.equal(at("a las 9.30", wed), "09:30");
  assert.equal(at("a las 9 pm", wed), "21:00");
  assert.equal(at("a las 21:30", wed), "21:30");
  assert.equal(at("Cena el 3 de octubre a las 9 y media de la noche", wed), "2026-10-03 21:30");
});

test("formas de decir la hora que antes no se entendían", () => {
  assert.equal(at("a la una", wed), "13:00");
  assert.equal(at("sobre las 9", wed), "09:00");
  assert.equal(at("hacia las 5 de la tarde", wed), "17:00");
  assert.equal(at("a mediodía", wed), "12:00");
  assert.equal(at("a las 2 de la madrugada", wed, true), "2026-09-24 02:00");
});

test("recordatorio con día dicho: la hora no se adivina según lo cerca que esté de ahora", () => {
  assert.equal(at("Recuérdame mañana a las 8", wed, true), "2026-09-24 08:00");
  assert.equal(at("Recuérdame el lunes a las 9", wed, true), "2026-09-28 09:00");
  assert.equal(at("mañana por la mañana a las 9", wed, true), "2026-09-24 09:00");
  assert.equal(at("el 1 de noviembre a las 10", wed, true), "2026-11-01 10:00");
  assert.equal(at("cena mañana a las 5", wed), "2026-09-24 17:00");
});

test("días: «este viernes» un viernes es hoy, «esta mañana» es hoy, gana el primer día que se dice", () => {
  assert.equal(at("este viernes", fri), "2026-09-25");
  assert.equal(at("el viernes", fri), "2026-10-02");
  assert.equal(at("Recuérdame esta mañana a las 11", wed, true), "2026-09-23 11:00");
  assert.equal(at("Recuérdame hoy a las once de la noche que mañana tengo médico", wed, true), "2026-09-23 23:00");
  assert.equal(at("Recuérdame el viernes comprar el pan para mañana", wed, true).slice(0, 10), "2026-09-25");
  assert.equal(explicitRelativeDate("a media mañana", wed), null);
});

test("«12 de la noche» es el día siguiente y «el día 20» ya pasado es el mes que viene", () => {
  assert.equal(at("hoy a las 12 de la noche", friNight, true), "2026-09-26 00:00");
  assert.equal(at("el día 20", fri), "2026-10-20");
  assert.equal(at("el 30", fri), "2026-09-30");
  assert.equal(at("el 6 de octubre del año que viene", wed), "2027-10-06");
  assert.equal(at("en una semana", wed), "2026-09-30");
});

test("se entiende escrito sin tildes", () => {
  assert.equal(at("manana a las 9", wed, true), "2026-09-24 09:00");
  assert.equal(at("el sabado", wed), "2026-09-26");
  assert.equal(at("pasado manana", wed), "2026-09-25");
});

test("títulos y búsquedas sin restos de la fecha", () => {
  assert.equal(cleanTemporalText("Dentista pasado mañana"), "Dentista");
  assert.equal(cleanTemporalText("la cena del lunes que viene"), "la cena");
  assert.equal(cleanTemporalText("la cita con Ana a las 9 de la mañana"), "la cita con Ana");
  assert.equal(cleanTemporalText("Reunión con Ana de esta tarde"), "Reunión con Ana");
  assert.equal(cleanTemporalText("Cena con Luis el próximo viernes"), "Cena con Luis");
  assert.equal(cleanTemporalText("Cena con Luis este viernes a las 21:00"), "Cena con Luis");
  assert.equal(cleanTemporalText("Cena con Vicente a las 9 y media de la noche en Casa Pepe"), "Cena con Vicente en Casa Pepe");
});

test("periodos de agenda: fin de semana y mes que viene; también en el acceso directo", () => {
  const sat = new Date(2026, 8, 26, 0, 30);
  assert.deepEqual(naturalQueryRange("¿Qué tengo el fin de semana?", sat), { rangeStart: "2026-09-26", rangeEnd: "2026-09-28" });
  assert.deepEqual(naturalQueryRange("¿Qué tengo el mes que viene?", sat), { rangeStart: "2026-10-01", rangeEnd: "2026-11-01" });
  const direct = routeShortcutIntent({ intent: "calendar.query", missingFields: [] }, { action: "calendar.query", direct: true }, "¿Qué tengo los próximos 3 días?", wed);
  assert.equal(direct.rangeStart, "2026-09-23");
});

test("un recordatorio de HOY ya pasado con hora de mañana pasa a la tarde", () => {
  const result = normalizeReminderSchedule({ intent: "reminder.create", date: "2026-09-23", time: "08:00", source: "ai" }, "Recuérdame hoy a las 8 llamar", wed);
  assert.equal(result.time, "20:00");
  const future = normalizeReminderSchedule({ intent: "reminder.create", date: "2026-09-23", time: "11:00", source: "ai" }, "Recuérdame hoy a las 11 llamar", wed);
  assert.equal(future.time, "11:00");
});

test("la búsqueda de eventos sin fecha empieza en la fecha LOCAL, no en la UTC", () => {
  const google = readFileSync(new URL("../js/google.js", import.meta.url), "utf8");
  assert.doesNotMatch(google, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(google, /const from = new Date\(`\$\{date \|\| localToday\}T00:00:00`\);/);
});

test("un mes por su nombre es el mes entero («¿Qué tengo pendiente el mes de octubre?»)", () => {
  const sep = new Date(2026, 8, 26, 10);
  assert.deepEqual(naturalQueryRange("¿Qué tengo pendiente el mes de octubre?", sep), { rangeStart: "2026-10-01", rangeEnd: "2026-11-01" });
  assert.deepEqual(naturalQueryRange("¿Qué tengo en marzo?", sep), { rangeStart: "2027-03-01", rangeEnd: "2027-04-01" });
  assert.deepEqual(naturalQueryRange("¿Qué tengo el 20 de octubre?", sep), { rangeStart: "2026-10-20", rangeEnd: "2026-10-21" }, "un día concreto sigue siendo ese día");
});
