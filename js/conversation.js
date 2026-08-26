/**
 * Estado conversacional de Angeli.
 *
 * Una entrada puede representar una operación que requiere varios turnos. El
 * historial sigue guardando la instrucción original; este módulo conserva el
 * contexto mínimo para que una respuesta como «a las doce» continúe esa misma
 * operación tras recargar o cambiar de dispositivo.
 */

export const INTERACTION_STATUS = {
  AWAITING_INPUT: "awaiting_input",
  PENDING_CONFIRMATION: "pending_confirmation",
  READY: "ready",
  EXECUTING: "executing",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  ERROR: "error"
};

const ACTIVE_STATES = new Set([
  INTERACTION_STATUS.AWAITING_INPUT,
  INTERACTION_STATUS.PENDING_CONFIRMATION,
  INTERACTION_STATUS.EXECUTING
]);
const DATA_FIELDS = ["title", "date", "time", "rangeStart", "rangeEnd", "location", "contactName", "phone", "notes", "target", "changes"];

export function findActiveInteraction(entries = []) {
  return entries
    .filter(entry => ACTIVE_STATES.has(entry?.interaction?.status))
    .sort((left, right) => String(right.interaction?.updatedAt || right.updatedAt || right.date || "").localeCompare(String(left.interaction?.updatedAt || left.updatedAt || left.date || "")))[0] || null;
}

export function contextFor(active) {
  if (!active?.interaction) return null;
  const interaction = active.interaction;
  return {
    interactionId: interaction.id,
    intent: interaction.intent,
    status: interaction.status,
    collectedData: interaction.collectedData || {},
    missingFields: interaction.missingFields || [],
    question: interaction.question || null,
    turns: (interaction.turns || []).slice(-6).map(turn => ({ role: turn.role, text: turn.text }))
  };
}

export function resolveConversationTurn({ active, text, interpretation, now = new Date().toISOString() }) {
  const prior = active?.aiIntent || null;
  const continuing = Boolean(active?.interaction && active.interaction.status === INTERACTION_STATUS.AWAITING_INPUT);
  const resolved = mergeInterpretation(prior, interpretation, continuing);
  const missingFields = missingFor(resolved);
  const requiresConfirmation = Boolean(resolved.requiresConfirmation);
  const status = missingFields.length
    ? INTERACTION_STATUS.AWAITING_INPUT
    : requiresConfirmation
      ? INTERACTION_STATUS.PENDING_CONFIRMATION
      : INTERACTION_STATUS.COMPLETED;
  const question = missingFields.length ? resolved.question || questionFor(resolved, missingFields) : null;
  const priorTurns = active?.interaction?.turns || [];
  const turns = [...priorTurns, { role: "user", text, at: now }].slice(-12);
  const id = active?.interaction?.id || crypto.randomUUID();
  return {
    interpretation: { ...resolved, missingFields, question },
    interaction: {
      id,
      intent: resolved.intent,
      status,
      source: resolved.source === "ai" ? "ai" : "fallback",
      fallbackReason: resolved.fallbackReason || null,
      collectedData: collectData(resolved),
      missingFields,
      question,
      turns,
      createdAt: active?.interaction?.createdAt || now,
      updatedAt: now,
      sourceEntryId: active?.id || null
    },
    continuing
  };
}

// Buscar para cancelar no requiere conocer cuándo se creó el aviso. Una
// respuesta «no lo sé» no convierte esa operación en una consulta sin acciones.
export function preserveCancellation(active, interpretation) {
  if (active?.interaction?.status === "awaiting_input"
      && active.aiIntent?.intent === "calendar.delete"
      && active.aiIntent.target?.title
      && ["reminder.query", "calendar.query", "note"].includes(interpretation.intent)) {
    return { ...interpretation, intent: "calendar.delete", target: active.aiIntent.target,
      missingFields: [], question: null, requiresConfirmation: true };
  }
  return interpretation;
}

export function cancelInteraction(entry, now = new Date().toISOString()) {
  if (!entry?.interaction) return entry;
  return {
    ...entry,
    interaction: {
      ...entry.interaction,
      status: INTERACTION_STATUS.CANCELLED,
      question: null,
      missingFields: [],
      updatedAt: now
    }
  };
}

export function completeInteraction(entry, now = new Date().toISOString()) {
  if (!entry?.interaction) return entry;
  return {
    ...entry,
    interaction: {
      ...entry.interaction,
      status: INTERACTION_STATUS.COMPLETED,
      question: null,
      missingFields: [],
      updatedAt: now
    }
  };
}

function mergeInterpretation(prior, next, continuing) {
  if (!prior || !continuing) return { ...next };
  const result = { ...prior, source: next.source, fallbackReason: next.fallbackReason || null };
  // Un fallback local no debe reinterpretar una respuesta corta como una orden
  // distinta. Puede completar únicamente los datos temporales que detecta.
  if (next.source === "ai") result.intent = next.intent || prior.intent;
  for (const field of DATA_FIELDS) {
    if (next[field] !== null && next[field] !== undefined && next[field] !== "") result[field] = next[field];
  }
  if (next.source === "ai" && typeof next.requiresConfirmation === "boolean") result.requiresConfirmation = next.requiresConfirmation;
  if (Array.isArray(next.missingFields)) result.missingFields = next.missingFields;
  if (next.question) result.question = next.question;
  return result;
}

function collectData(intent) {
  return Object.fromEntries(DATA_FIELDS.filter(field => intent[field] !== null && intent[field] !== undefined && intent[field] !== "").map(field => [field, intent[field]]));
}

function missingFor(intent) {
  if (intent.intent === "calendar.delete") return intent.target?.title ? [] : ["target"];
  if (Array.isArray(intent.missingFields) && intent.missingFields.length) return uniqueKnownFields(intent.missingFields);
  if (intent.intent === "calendar.create") return [!intent.date && "date", !intent.time && "time"].filter(Boolean);
  if (intent.intent === "reminder.create") return [!intent.date && "date", !intent.time && "time"].filter(Boolean);
  if ((intent.intent === "calendar.update" || intent.intent === "calendar.delete") && !intent.target?.title) return ["target"];
  return [];
}

function uniqueKnownFields(fields) {
  const allowed = new Set(["title", "date", "time", "location", "contactName", "phone", "target"]);
  return [...new Set(fields.filter(field => allowed.has(field)))];
}

function questionFor(intent, missingFields) {
  if (missingFields.includes("date") && missingFields.includes("time")) return "¿Qué día y a qué hora?";
  if (missingFields.includes("date")) return "¿Qué día quieres hacerlo?";
  if (missingFields.includes("time")) return "¿A qué hora?";
  if (missingFields.includes("target")) return "¿Qué evento quieres modificar o cancelar?";
  if (missingFields.includes("contactName") || missingFields.includes("phone")) return "¿A quién quieres llamar?";
  return "¿Puedes darme un poco más de información?";
}
