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
const DATA_FIELDS = ["title", "date", "time", "rangeStart", "rangeEnd", "location", "contactName", "phone", "notes", "noteQuery", "noteClassification", "target", "changes", "linkedReminder"];

export function findActiveInteraction(entries = []) {
  return entries
    .filter(entry => ACTIVE_STATES.has(entry?.interaction?.status))
    .sort((left, right) => String(right.interaction?.updatedAt || right.updatedAt || right.date || "").localeCompare(String(left.interaction?.updatedAt || left.updatedAt || left.date || "")))[0] || null;
}

// 3ª auditoría: las respuestas cortas a una operación pendiente se detectan
// como FRASE COMPLETA. Antes bastaba con que empezara por «sí/no», así que «si
// puedes, recuérdame…» contaba como «sí» y «no te olvides de…» como «no»; y
// «Sí» con tilde no casaba nunca (\b tras «í» sin la bandera u). Una respuesta
// con más contenido («sí, pero a las 11», «no, el jueves») no es un sí/no: es
// una corrección que debe pasar por el intérprete.
const YES_REPLY = /^(?:s[ií]|vale|ok|okay|de\s+acuerdo|confirm[oa]|confirmado|adelante|venga|dale|perfecto|correcto|eso\s+es|hazlo|claro)(?:[\s,]+(?:s[ií]|por\s+favor|gracias|claro|perfecto|vale))*[.!\s]*$/iu;
const NO_REPLY = /^(?:no|mejor\s+no|no\s+gracias|canc[eé]la(?:lo)?|anula(?:lo)?|d[eé]jalo|olv[ií]dalo)(?:[\s,]+(?:gracias|por\s+favor))*[.!\s]*$/iu;
export function confirmationReply(text = "") {
  const value = String(text || "").trim();
  if (YES_REPLY.test(value)) return "yes";
  if (NO_REPLY.test(value)) return "no";
  return null;
}

// «Cancela», «déjalo», «olvídalo», «no importa»… mientras Angeli espera un
// dato. Antes no existía forma de soltar una pregunta: la frase se tomaba como
// el dato («déjalo» como título) y la pregunta se repetía para siempre.
const CANCEL_REPLY = /^(?:no\s*,?\s*)?(?:canc[eé]la(?:lo|r)?|anula(?:lo)?|d[eé]jalo(?:\s+estar)?|olv[ií]dalo|no\s+importa|da\s+igual|ya\s+no|nada|d[eé]jalo\s+as[ií]|para|basta)(?:[\s,]+(?:gracias|por\s+favor|mejor))*[.!\s]*$/iu;
export function isCancelReply(text = "") {
  return CANCEL_REPLY.test(String(text || "").trim());
}

// Familia de cada intención, para saber si una respuesta de la IA continúa la
// operación pendiente o es una orden nueva de otro tipo.
export function intentDomain(intent) {
  if (!intent) return null;
  if (intent === "contact.call") return "call";
  if (intent.startsWith("calendar.")) return intent === "calendar.query" ? "agenda" : "calendar";
  if (intent === "reminder.create") return "reminder";
  if (intent === "whatsapp.compose") return "whatsapp";
  if (intent === "note") return "note";
  if (intent.endsWith(".query")) return "query";
  if (intent.startsWith("task.")) return "task";
  return intent;
}

// Una respuesta de la IA, con confianza, de OTRA familia que la operación
// pendiente es una orden nueva: no debe fundirse con la pendiente (antes el
// «Recuérdame comprar pan» nuevo heredaba el contacto «Pepe» y el texto del
// «Recuérdame llamar a Pepe» a medias, y una nota nueva heredaba la ubicación
// del evento pendiente). Llamar ⇄ recordatorio se consideran la misma familia
// porque «llámale mañana» es la respuesta natural a un aviso de llamada.
export function isNewCommand(active, interpretation) {
  if (!active?.interaction || active.interaction.status !== INTERACTION_STATUS.AWAITING_INPUT) return false;
  if (interpretation?.source !== "ai") return false;
  const before = intentDomain(active.aiIntent?.intent), after = intentDomain(interpretation.intent);
  if (!before || !after || before === after) return false;
  const related = new Set(["call:reminder", "reminder:call", "calendar:reminder", "reminder:calendar"]);
  return !related.has(`${before}:${after}`);
}

// 3ª auditoría: al responder «a las 10» después de haber dicho «mañana», la
// normalización calculaba la fecha solo con la frase actual y pisaba la ya
// recogida (aviso hoy, en el pasado). Lo recogido completa la respuesta ANTES
// de normalizar. Sin IA, lo que la frase DICE (`spoken`, sin inferir el día)
// manda: «a las diez» tras «mañana» son las 10:00 de mañana, no las 22:00 de
// hoy que infería el respaldo.
export function completeFromCollected(active, interpretation, spoken = {}) {
  if (active?.interaction?.status !== INTERACTION_STATUS.AWAITING_INPUT) return interpretation;
  const prior = active.aiIntent || {};
  if (interpretation.source === "ai") return { ...interpretation, date: interpretation.date || prior.date || null, time: interpretation.time || prior.time || null };
  return { ...interpretation, date: spoken.scheduledDate || prior.date || interpretation.date || null, time: spoken.scheduledTime || prior.time || interpretation.time || null };
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
  // 3ª auditoría: con respaldo local, un aviso o evento completo quedaba como
  // «completed» en vez de pendiente de confirmar. Crear algo con fecha y hora
  // siempre se confirma.
  const requiresConfirmation = Boolean(resolved.requiresConfirmation)
    || (["reminder.create", "calendar.create"].includes(resolved.intent) && Boolean(resolved.date && resolved.time));
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
  // 3ª auditoría: la pregunta anterior ya no se arrastra («¿Qué día y a qué
  // hora?» después de haber dicho el día); se recalcula con lo que falte.
  const result = { ...prior, source: next.source, fallbackReason: next.fallbackReason || null, question: null };
  const linkedOperation = prior.intent === "calendar.create" && prior.linkedReminder;
  // Un fallback local no debe reinterpretar una respuesta corta como una orden
  // distinta. Puede completar únicamente los datos temporales que detecta.
  if (next.source === "ai" && !linkedOperation) result.intent = next.intent || prior.intent;
  for (const field of DATA_FIELDS) {
    if (linkedOperation && ["title", "location", "linkedReminder"].includes(field)) continue;
    // 3ª auditoría: el respaldo local devuelve la frase entera como título
    // («mañana a las 10» acababa siendo el título del recordatorio). Sin IA, la
    // respuesta solo rellena lo que faltaba, salvo fecha y hora, que es justo
    // lo que el respaldo sabe detectar.
    const known = prior[field] !== null && prior[field] !== undefined && prior[field] !== "";
    if (next.source !== "ai" && known && !["date", "time"].includes(field)) continue;
    if (next[field] !== null && next[field] !== undefined && next[field] !== "") result[field] = next[field];
  }
  if (linkedOperation && result.time && !result.linkedReminder.time) result.linkedReminder = { ...result.linkedReminder, time: result.time };
  if (next.source === "ai" && typeof next.requiresConfirmation === "boolean") result.requiresConfirmation = next.requiresConfirmation;
  // La lista de lo que falta de la vuelta anterior ya no vale: se recalcula.
  result.missingFields = Array.isArray(next.missingFields) ? next.missingFields : null;
  if (next.question) result.question = next.question;
  return result;
}

function collectData(intent) {
  return Object.fromEntries(DATA_FIELDS.filter(field => intent[field] !== null && intent[field] !== undefined && intent[field] !== "").map(field => [field, intent[field]]));
}

function missingFor(intent) {
  if (intent.intent === "calendar.delete") return intent.target?.title ? [] : ["target"];
  if (intent.intent === "calendar.update") {
    if (!intent.target?.title) return ["target"];
    if (!intent.changes || !Object.keys(intent.changes).length) return ["date", "time"];
    return [];
  }
  // 3ª auditoría: nunca se pide algo que ya está («¿Qué día y a qué hora?»
  // después de haber dicho el día, o repetirlo con los dos ya dados).
  if (Array.isArray(intent.missingFields) && intent.missingFields.length) {
    const present = { title: intent.title, date: intent.date, time: intent.time, location: intent.location, contactName: intent.contactName || intent.phone, phone: intent.phone || intent.contactName, notes: intent.notes, target: intent.target?.title };
    const stillMissing = uniqueKnownFields(intent.missingFields).filter(field => !present[field]);
    if (stillMissing.length || !["reminder.create", "calendar.create", "whatsapp.compose"].includes(intent.intent)) return stillMissing;
  }
  if (intent.intent === "calendar.create") return [!intent.date && "date", !intent.time && "time"].filter(Boolean);
  if (intent.intent === "reminder.create") return [!intent.date && "date", !intent.time && "time"].filter(Boolean);
  if (intent.intent === "whatsapp.compose") return [!intent.contactName && !intent.phone && "contactName", !intent.notes && "notes"].filter(Boolean);
  if ((intent.intent === "calendar.update" || intent.intent === "calendar.delete") && !intent.target?.title) return ["target"];
  return [];
}

function uniqueKnownFields(fields) {
  const allowed = new Set(["title", "date", "time", "location", "contactName", "phone", "notes", "target"]);
  return [...new Set(fields.filter(field => allowed.has(field)))];
}

function questionFor(intent, missingFields) {
  if (intent.intent === "calendar.update" && missingFields.includes("date") && missingFields.includes("time")) return "¿Para qué día u hora quieres cambiarlo?";
  if (missingFields.includes("date") && missingFields.includes("time")) return "¿Qué día y a qué hora?";
  if (missingFields.includes("date")) return "¿Qué día quieres hacerlo?";
  if (missingFields.includes("time")) return "¿A qué hora?";
  if (missingFields.includes("target")) return "¿Qué evento quieres modificar o cancelar?";
  if (missingFields.includes("contactName") || missingFields.includes("phone")) return intent.intent === "whatsapp.compose" ? "¿A quién quieres escribir por WhatsApp?" : "¿A quién quieres llamar?";
  if (missingFields.includes("notes")) return "¿Qué mensaje quieres escribir?";
  return "¿Puedes darme un poco más de información?";
}
