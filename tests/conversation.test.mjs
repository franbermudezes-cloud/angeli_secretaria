import test from "node:test";
import assert from "node:assert/strict";

import {
  INTERACTION_STATUS,
  cancelInteraction,
  completeInteraction,
  contextFor,
  findActiveInteraction,
  resolveConversationTurn,
} from "../js/conversation.js";
import { normalizeFutureCall, normalizeReminderSchedule } from "../js/schedule.js";

const NOW = "2026-08-24T08:00:00.000Z";

function intent(overrides = {}) {
  return {
    intent: "reminder.create",
    confidence: 0.96,
    title: "Llamar a Pepe",
    date: "2026-08-25",
    time: null,
    rangeStart: null,
    rangeEnd: null,
    location: null,
    contactName: "Pepe",
    phone: null,
    notes: null,
    target: null,
    changes: null,
    missingFields: ["time"],
    question: "¿A qué hora quieres que te lo recuerde?",
    requiresConfirmation: true,
    source: "ai",
    fallbackReason: null,
    ...overrides,
  };
}

test("P01 pregunta solo la hora que falta y mantiene abierta la operación", () => {
  const turn = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });

  assert.equal(turn.interaction.status, INTERACTION_STATUS.AWAITING_INPUT);
  assert.deepEqual(turn.interaction.missingFields, ["time"]);
  assert.equal(turn.interaction.question, "¿A qué hora quieres que te lo recuerde?");
  assert.equal(turn.interpretation.date, "2026-08-25");
});

test("P02 una respuesta corta completa la misma operación sin cambiar su intención", () => {
  const first = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });
  const active = {
    id: "entry-p01",
    date: NOW,
    aiIntent: first.interpretation,
    interaction: first.interaction,
  };
  const second = resolveConversationTurn({
    active,
    text: "A las doce",
    interpretation: intent({
      intent: "note",
      confidence: 0.5,
      title: null,
      date: null,
      time: "12:00",
      contactName: null,
      missingFields: [],
      question: null,
      source: "fallback",
      fallbackReason: "service_unavailable",
    }),
    now: "2026-08-24T08:01:00.000Z",
  });

  assert.equal(second.continuing, true);
  assert.equal(second.interpretation.intent, "reminder.create");
  assert.equal(second.interpretation.date, "2026-08-25");
  assert.equal(second.interpretation.time, "12:00");
  assert.equal(second.interaction.status, INTERACTION_STATUS.PENDING_CONFIRMATION);
  assert.equal(second.interaction.id, first.interaction.id);
});

test("un recordatorio completo no hace una pregunta innecesaria", () => {
  const turn = resolveConversationTurn({
    active: null,
    text: "Recuérdame mañana a las doce llamar a Pepe",
    interpretation: intent({ time: "12:00", missingFields: [], question: null }),
    now: NOW,
  });

  assert.equal(turn.interaction.status, INTERACTION_STATUS.PENDING_CONFIRMATION);
  assert.deepEqual(turn.interaction.missingFields, []);
  assert.equal(turn.interaction.question, null);
});

test("cancelar y completar cierran la interacción activa", () => {
  const first = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });
  const entry = { id: "entry-p01", interaction: first.interaction };

  assert.equal(cancelInteraction(entry, NOW).interaction.status, INTERACTION_STATUS.CANCELLED);
  assert.equal(completeInteraction(entry, NOW).interaction.status, INTERACTION_STATUS.COMPLETED);
  assert.equal(findActiveInteraction([cancelInteraction(entry, NOW)]), null);
});

test("el contexto enviado a la IA contiene solo el estado conversacional necesario", () => {
  const first = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });
  const context = contextFor({ interaction: first.interaction });

  assert.equal(context.intent, "reminder.create");
  assert.deepEqual(context.missingFields, ["time"]);
  assert.deepEqual(context.collectedData, {
    title: "Llamar a Pepe",
    date: "2026-08-25",
    contactName: "Pepe",
  });
  assert.equal(context.turns.at(-1).text, "Mañana tengo que llamar a Pepe");
});

test("una llamada con día pero sin hora se convierte en recordatorio y pregunta la hora", () => {
  const normalized = normalizeReminderSchedule(normalizeFutureCall(intent({
    intent: "contact.call",
    date: "2026-08-25",
    time: null,
    missingFields: [],
    question: null,
  }), "Llama a Pepe mañana"), "Llama a Pepe mañana", new Date(NOW));
  const turn = resolveConversationTurn({ active: null, text: "Llama a Pepe mañana", interpretation: normalized, now: NOW });

  assert.equal(turn.interpretation.intent, "reminder.create");
  assert.deepEqual(turn.interaction.missingFields, ["time"]);
  assert.equal(turn.interaction.question, "¿A qué hora?");
});

test("una llamada con hora pero sin día programa la próxima ocurrencia", () => {
  const normalized = normalizeReminderSchedule(normalizeFutureCall(intent({
    intent: "contact.call",
    date: null,
    time: "19:00",
    missingFields: [],
    question: null,
  }), "Llama a Pepe a las siete"), "Llama a Pepe a las siete", new Date(NOW));

  assert.equal(normalized.intent, "reminder.create");
  assert.equal(normalized.date, "2026-08-24");
  assert.equal(normalized.time, "19:00");
});

test("una llamada sin referencia temporal sigue siendo inmediata", () => {
  const immediate = intent({ intent: "contact.call", date: null, time: null });
  assert.equal(normalizeFutureCall(immediate, "Llama a Pepe").intent, "contact.call");
});
