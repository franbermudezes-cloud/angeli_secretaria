import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { interpret, localCalendarUpdate, localImmediateCall, localIsoNow, localNoteQuery, localReminderQuery, protectCalendarInterpretation, protectReadQuery } from "../js/ai.js";
import { normalizeReminderSchedule, normalizeUndatedCall } from "../js/schedule.js";
import { localWhatsApp } from "../js/whatsapp.js";

// 3ª auditoría: la IA entendía bien, pero una regla local pisaba su respuesta
// con otra peor. En una batería de 52 órdenes, 30 respuestas CORRECTAS de la IA
// acababan mal. Principio: cuando la IA respondió con confianza, lo local solo
// rellena huecos; nunca cambia la intención ni pisa datos que la IA ya dio.
const now = new Date(2026, 8, 23, 10);

test("localCalendarUpdate ya no convierte recordatorios, tareas ni notas en «modificar evento»", () => {
  for (const text of [
    "Recuérdame pasar por el banco mañana a las diez",
    "Recuérdame cambiar el aceite del coche el lunes a las 9",
    "Tengo que pasar la ITV el jueves a las 9",
    "Mañana a las diez pasa el técnico de la caldera",
    "Mañana tengo que mover el coche a las ocho",
    "He hablado con Pedro y dice que pasa la reunión al jueves"
  ]) assert.equal(localCalendarUpdate(text, now, null), null, text);
  // Las órdenes reales de reprogramar se siguen reconociendo.
  for (const text of [
    "Pasa la llamada de Miguel al viernes a las 11",
    "Cámbiame la hora de Miguel",
    "Retrasa el recordatorio de Carlos hasta mañana",
    "La llamada de Miguel ahora cambia de hora a las 11"
  ]) assert.equal(localCalendarUpdate(text, now, null)?.intent, "calendar.update", text);
});

test("al reprogramar, la fecha y la hora nuevas se leen detrás de «al / a las» y son correctas", () => {
  const sat = protectCalendarInterpretation(
    { intent: "calendar.update", confidence: .9, target: { title: "cena" }, changes: { date: "2026-09-26" }, source: "ai" },
    localCalendarUpdate("Cambia la cena del viernes al sábado", now, null));
  assert.equal(sat.changes.date, "2026-09-26");
  const late = protectCalendarInterpretation(
    { intent: "calendar.update", confidence: .9, target: { title: "cena con Vicente" }, changes: { time: "21:30" }, source: "ai" },
    localCalendarUpdate("Pasa la cena con Vicente a las 9 y media de la noche", now, null));
  assert.equal(late.changes.time, "21:30");
});

test("recordatorio: gana el PRIMER día dicho, no un «hoy/mañana» del contenido", () => {
  const friday = normalizeReminderSchedule({ intent: "reminder.create", date: "2026-09-25", time: "10:00", source: "ai" }, "Recuérdame el viernes comprar el pan para mañana", now);
  assert.equal(friday.date, "2026-09-25");
  const monday = normalizeReminderSchedule({ intent: "reminder.create", date: "2026-09-28", time: "09:00", source: "ai" }, "Recuérdame el lunes preparar lo de hoy", now);
  assert.equal(monday.date, "2026-09-28");
  // Sin fecha de la IA, lo local sigue decidiendo.
  const local = normalizeReminderSchedule({ intent: "reminder.create", date: null, time: "10:00", source: "fallback" }, "Recuérdame mañana a las 10 llamar", now);
  assert.equal(local.date, "2026-09-24");
});

test("una orden de crear ya no se confunde con una consulta de recordatorios o notas", () => {
  assert.equal(localReminderQuery("Quiero que me pongas un recordatorio mañana a las 9 para ir al médico"), null);
  assert.equal(localReminderQuery("Necesito que me crees un recordatorio para el lunes"), null);
  assert.equal(localNoteQuery("Dile a Ana que me pase las notas del examen"), null);
  assert.equal(localNoteQuery("Tengo que estudiar las notas de química"), null);
  assert.equal(localNoteQuery("Reunión mañana a las 10 para ver las notas del trimestre"), null);
  // Las consultas reales se siguen reconociendo.
  assert.equal(localReminderQuery("¿Qué recordatorios tengo?")?.intent, "reminder.query");
  assert.equal(localReminderQuery("Recordatorios")?.intent, "reminder.query");
  assert.equal(localNoteQuery("Ver las notas hechas")?.intent, "note.query");
  assert.equal(localNoteQuery("¿Qué notas tengo del proyecto Karaoke?")?.intent, "note.query");
});

test("una consulta en la que la IA coincide conserva lo que la IA entendió (a quién o qué busca)", () => {
  const local = localReminderQuery("¿Qué recordatorios tengo con Pedro?");
  const merged = protectReadQuery({ intent: "reminder.query", confidence: .9, target: { title: "Pedro", date: null, time: null }, source: "ai" }, null, local);
  assert.equal(merged.target.title, "Pedro");
  assert.equal(merged.source, "ai");
});

test("una nota o tarea que menciona una llamada, o una llamada con hora, no es una llamada inmediata", () => {
  for (const text of [
    "Apunta que tengo que llamar al fontanero",
    "Anota: llamar al seguro para el parte",
    "Tengo que llamar a Juan esta semana",
    "Llama a Ana esta noche",
    "Llama a Ana por la tarde",
    "Llama a Ana en media hora"
  ]) assert.equal(localImmediateCall(text, now), null, text);
  assert.equal(localImmediateCall("Llama a Ana para preguntarle por el presupuesto", now).contactName, "Ana");
  assert.equal(localImmediateCall("Llama a mi madre al móvil", now).contactName, "mi madre");
});

test("normalizeUndatedCall conserva el contacto limpio que dio la IA", () => {
  const call = normalizeUndatedCall({ intent: "contact.call", contactName: "Ana", source: "ai" }, "Llama a Ana para preguntarle por el presupuesto", null, now);
  assert.equal(call.contactName, "Ana");
});

test("WhatsApp local: separa contacto y mensaje sin necesitar «dile»", () => {
  const cases = [
    ["Envía un WhatsApp a Ana que llego tarde", "Ana", "llego tarde"],
    ["Envía un WhatsApp a Ana y dile que llego tarde", "Ana", "que llego tarde"],
    ["Whatsapp a Luis, que ya estoy abajo", "Luis", "que ya estoy abajo"],
    ["Mándale un WhatsApp a Pedro para decirle que la cena es a las nueve", "Pedro", "que la cena es a las nueve"],
    ["Envía un WhatsApp a Juan Pérez diciéndole que voy para allá", "Juan Pérez", "que voy para allá"]
  ];
  for (const [text, contactName, notes] of cases) {
    const wa = localWhatsApp(text, null);
    assert.equal(wa.contactName, contactName, text);
    assert.equal(wa.notes, notes, text);
  }
  const byNumber = localWhatsApp("Envía un WhatsApp al 612345678 que llego", null);
  assert.equal(byNumber.phone, "612345678");
  assert.equal(byNumber.contactName, null);
});

test("responder a un WhatsApp pendiente con la IA caída ya no revienta con «Campo IA no permitido»", async () => {
  const active = { interaction: { status: "awaiting_input", missingFields: ["notes"] },
    aiIntent: { intent: "whatsapp.compose", contactName: "Juan", notes: null, confidence: .9, source: "ai", fallbackReason: null, missingFields: ["notes"] } };
  const result = await interpret("que llego tarde", { provider: async () => { throw new Error("IA no disponible (503)"); }, fallback: () => localWhatsApp("que llego tarde", active) });
  assert.equal(result.intent, "whatsapp.compose");
  assert.equal(result.contactName, "Juan");
  assert.equal(result.notes, "que llego tarde");
});

test("add(): el texto de un WhatsApp no se lee como cambiar/cancelar evento, y un WhatsApp pendiente no pisa a la IA", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /const cancellation=\(localLinked\|\|whatsApp\|\|/);
  assert.match(app, /const localUpdate=\(localLinked\|\|whatsApp\|\|/);
  assert.match(app, /const forceWhatsApp=Boolean\(whatsApp\)&&\(aiWhatsApp\|\|interpreted\.source!=="ai"\|\|Boolean\(localWhatsApp\(text,null\)\)\|\|\(active\?\.aiIntent\?\.intent==="whatsapp\.compose"&&\(active\.interaction\?\.missingFields\|\|\[\]\)\.includes\("notes"\)\)\);/, "un WhatsApp que espera el MENSAJE toma el texto como mensaje");
});

test("la hora que se envía a la IA es la local con su desfase, no UTC", () => {
  const value = localIsoNow(new Date(2026, 8, 26, 0, 30, 0));
  assert.match(value, /^2026-09-26T00:30:00[+-]\d{2}:\d{2}$/);
  assert.doesNotMatch(value, /Z$/);
});

// Revisión con el propietario (preocupado por que se hubiera quitado la lógica
// y dejado solo la IA): el historial tiene casos reales en que la IA se
// equivocaba y lo local la corregía. Se prueban aquí CON source:"ai", que es
// como llegan de verdad (los tests antiguos no lo marcaban y por eso la primera
// versión de la 3ª auditoría reabrió el #6 sin que nada fallara).
test("historial #6: «pasado mañana» manda aunque la IA diga mañana", () => {
  const aug = new Date(2026, 7, 26, 12);
  const text = "Recuérdame llamar a Carlos Ferrer pasado mañana a las once de la mañana";
  assert.equal(normalizeReminderSchedule({ intent: "reminder.create", source: "ai", date: "2026-08-27", time: "11:00" }, text, aug).date, "2026-08-28");
  // Sin ningún día en la frase, la fecha de la IA sigue mandando.
  assert.equal(normalizeReminderSchedule({ intent: "reminder.create", source: "ai", date: "2026-09-30", time: "11:00" }, "Recuérdame llamar a Pepe", now).date, "2026-09-30");
});

test("mover un evento: el día nuevo dicho manda aunque la IA se equivoque; mañana/tarde sin franja lo decide la IA", () => {
  const move = (text, changes) => protectCalendarInterpretation({ intent: "calendar.update", confidence: .9, target: { title: "x" }, source: "ai", changes }, localCalendarUpdate(text, now, null)).changes;
  assert.equal(move("Cambia la cena del viernes al sábado", { date: "2026-09-25" }).date, "2026-09-26");
  assert.deepEqual(move("Mueve la reunión del jueves a las 10 al viernes a las 12", {}), { date: "2026-09-25", time: "12:00" });
  assert.equal(move("Pasa la cena con Vicente a las 9 y media de la noche", { time: "09:30" }).time, "21:30", "franja dicha: manda lo dicho");
  const dinner = move("Cambia la cena con Laura a las nueve y ponla en Casa Pepe", { time: "21:00", location: "Casa Pepe" });
  assert.equal(dinner.time, "21:00", "«a las nueve» sin franja en una cena: la IA tiene el contexto");
  assert.equal(dinner.location, "Casa Pepe", "los cambios que solo entiende la IA se conservan");
});

test("historial #39: una pregunta con «?» sobre recordatorios o notas sigue siendo consulta", () => {
  assert.equal(localReminderQuery("¿Tengo recordatorios para mañana?")?.intent, "reminder.query");
  assert.equal(localNoteQuery("¿Tengo notas del proyecto Karaoke?")?.intent, "note.query");
});

test("historial #76: «quiero llamar a Ana» sigue forzando la llamada si la IA dice nota", () => {
  const local = localImmediateCall("quiero llamar a Ana", now);
  assert.equal(local?.contactName, "Ana");
});
