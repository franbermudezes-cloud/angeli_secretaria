import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeFromCollected, confirmationReply, isCancelReply, isNewCommand, resolveConversationTurn } from "../js/conversation.js";
import { normalizeReminderSchedule } from "../js/schedule.js";
import { temporalData } from "../js/temporal.js";

// 3ª auditoría (agente de conversación a varios turnos). Casos reales.
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const now = new Date(2026, 8, 25, 12, 0);

test("«sí/no» se reconocen como frase completa; lo demás no es una respuesta de sí/no", () => {
  for (const text of ["sí", "Sí.", "Sí claro", "si", "vale", "ok", "de acuerdo", "venga", "perfecto"]) assert.equal(confirmationReply(text), "yes", text);
  for (const text of ["no", "No, gracias", "mejor no", "cancélalo"]) assert.equal(confirmationReply(text), "no", text);
  for (const text of ["si puedes, recuérdame llamar", "no te olvides de comprar pan", "No sé", "anula la cita con Pepe", "Sí, pero a las 11", "no, el jueves"]) assert.equal(confirmationReply(text), null, text);
});

test("«cancela/déjalo/olvídalo» sueltan la pregunta pendiente; una orden completa no", () => {
  for (const text of ["cancela", "Déjalo", "olvídalo", "no importa", "da igual", "déjalo estar"]) assert.equal(isCancelReply(text), true, text);
  for (const text of ["cancela la cena con Pepe", "déjalo en la mesa", "no te olvides"]) assert.equal(isCancelReply(text), false, text);
});

test("una respuesta de la IA de otra familia es una orden nueva; la de la misma familia continúa", () => {
  const reminder = { interaction: { status: "awaiting_input" }, aiIntent: { intent: "reminder.create", contactName: "Pepe" } };
  assert.equal(isNewCommand(reminder, { source: "ai", intent: "note" }), true);
  assert.equal(isNewCommand(reminder, { source: "ai", intent: "calendar.query" }), true);
  assert.equal(isNewCommand(reminder, { source: "ai", intent: "reminder.create" }), false);
  assert.equal(isNewCommand(reminder, { source: "ai", intent: "contact.call" }), false, "«llámale mañana» responde a un aviso de llamada");
  assert.equal(isNewCommand(reminder, { source: "fallback", intent: "note" }), false, "sin IA no se decide que es una orden nueva");
  const whatsapp = { interaction: { status: "awaiting_input" }, aiIntent: { intent: "whatsapp.compose", contactName: "Juan" } };
  assert.equal(isNewCommand(whatsapp, { source: "ai", intent: "calendar.create" }), true, "«tengo cita con el dentista el jueves» no es el mensaje de Juan");
});

test("diálogo completo sin IA: «Recuérdame comprar pan» → «mañana» → «a las diez»", () => {
  const step = (active, text) => {
    const guess = temporalData(text, now, { inferDateFromTime: true });
    const raw = { intent: "reminder.create", source: "fallback", title: text, date: guess.scheduledDate || null, time: guess.scheduledTime || null };
    const normalized = normalizeReminderSchedule(completeFromCollected(active, raw, temporalData(text, now)), text, now);
    return resolveConversationTurn({ active, text, interpretation: normalized, now: now.toISOString() });
  };
  let turn = resolveConversationTurn({ text: "Recuérdame comprar pan", interpretation: { intent: "reminder.create", source: "ai", title: "Comprar pan", date: null, time: null, missingFields: ["date", "time"], requiresConfirmation: false }, now: now.toISOString() });
  let active = { id: "r1", aiIntent: turn.interpretation, interaction: turn.interaction };
  turn = step(active, "mañana");
  assert.equal(turn.interaction.question, "¿A qué hora?", "no vuelve a preguntar el día ya dicho");
  assert.equal(turn.interpretation.title, "Comprar pan", "la respuesta no se convierte en el título");
  active = { id: "r1", aiIntent: turn.interpretation, interaction: turn.interaction };
  turn = step(active, "a las diez");
  assert.equal(turn.interpretation.date, "2026-09-26", "conserva el día ya dicho (antes: hoy, en el pasado)");
  assert.equal(turn.interpretation.time, "10:00", "las diez de mañana, no las 22:00 inferidas");
  assert.equal(turn.interpretation.title, "Comprar pan");
  assert.equal(turn.interaction.status, "pending_confirmation", "un aviso completo siempre se confirma");
});

test("con la IA, lo ya recogido completa la respuesta que solo trae la hora", () => {
  const active = { interaction: { status: "awaiting_input" }, aiIntent: { intent: "reminder.create", date: "2026-09-26", time: null } };
  const completed = completeFromCollected(active, { intent: "reminder.create", source: "ai", date: null, time: "10:00" }, {});
  assert.equal(completed.date, "2026-09-26");
});

test("add(): cancelar por voz, «sí/no» a la confirmación reciente, orden nueva cancela la anterior", () => {
  assert.match(app, /if\(active\?\.interaction\?\.status==="awaiting_input"&&isCancelReply\(text\)\)\{/);
  assert.match(app, /const reply=confirmationReply\(text\);/);
  assert.match(app, /item\.interaction\?\.status==="pending_confirmation"&&Date\.parse\(item\.interaction\.updatedAt\|\|item\.updatedAt\|\|0\)>=recent/);
  assert.match(app, /if\(reply==="yes"\)\{clearComposer\(\);ui\.showEntryAction\(active,google\);return\}/, "«sí» abre la confirmación: nunca ejecuta solo una acción sensible");
  assert.match(app, /if\(isNewCommand\(active,whatsAppInterpretation\)\)\{dropped=active;active=null;id=crypto\.randomUUID\(\)\}/);
  assert.match(app, /\.map\(item=>dropped&&item\.id===dropped\.id\?cancelInteraction\(item\):item\)/);
  assert.match(app, /const withCollected=completeFromCollected\(active,routedInterpretation,temporalData\(text,now\)\);/);
});

test("modo conversación: pregunta reciente, relleno que no corta la respuesta y sin bucles de error", () => {
  assert.match(app, /function conversationActiveQuestionEntry\(\)\{const recent=Date\.now\(\)-30\*60\*1000;/);
  assert.match(app, /if\(conversationAsideAllowed\)await speakAloud\(reply\);/);
  assert.match(app, /conversationAsideAllowed=true;\n void speakConversationalAside\(text\);/);
  assert.match(app, /if\(event\.error==="no-speech"\)\{conversationSilences\+=1;if\(conversationSilences>=4\)\{conversationManualStop=true;/);
  assert.match(app, /conversationManualStop=true;\n  ui\.setConversationStatus\(event\.error==="network"\?/);
});
