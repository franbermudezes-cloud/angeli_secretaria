import { completeInteraction, cancelInteraction } from "./conversation.js?v=0.21.12";

// Solo tras confirmar el éxito del borrado que acaba de ejecutar Angeli.
export function markCancelledReminder(entries, eventId) {
  return entries.map(entry => entry.schedule?.calendarEventId === eventId
    ? { ...cancelInteraction(entry), schedule: { ...entry.schedule, status: "cancelled" } }
    : entry);
}

const COMPLETABLE_TYPES = new Set(["task", "reminder", "contact"]);
const STOP_WORDS = new Set([
  "a", "al", "de", "del", "el", "he", "la", "las", "lo", "los", "un", "una",
  "ya", "llama", "llamar", "llamado", "completa", "completar", "hecho", "terminado"
]);

export function findPendingMatches(entries = [], interpretation = {}) {
  const query = interpretation.target?.title || interpretation.contactName || interpretation.title || "";
  const tokens = meaningfulTokens(query);
  if (!tokens.length) return [];

  return entries
    .filter(isCompletable)
    .map(entry => ({ entry, score: matchScore(entry, tokens) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || recent(right.entry).localeCompare(recent(left.entry)))
    .map(candidate => candidate.entry);
}

export function findReminderMatches(entries = [], interpretation = {}) {
  const query = interpretation.target?.title || interpretation.contactName || "";
  const tokens = meaningfulTokens(query);

  return entries
    // Cerrar la conversación al programar no significa realizar el recordatorio.
    .filter(entry => entry?.type === "reminder" && entry.status !== "done"
      && entry.interaction?.status !== "cancelled"
      && !["cancelled", "completed"].includes(entry.schedule?.status))
    .map(entry => ({ entry, score: tokens.length ? matchScore(entry, tokens) : 1 }))
    .filter(candidate => candidate.score === 1)
    .sort((left, right) => right.score - left.score || recent(right.entry).localeCompare(recent(left.entry)))
    .map(candidate => candidate.entry);
}

export function completePending(entry, now = new Date().toISOString()) {
  const completed = completeInteraction(entry, now);
  return {
    ...completed,
    status: "done",
    updatedAt: now,
    ...(entry.schedule ? { schedule: { ...entry.schedule, status: "completed" } } : {})
  };
}

export function completionTarget(text = "") {
  const cleaned = text
    .replace(/^\s*(?:ya\s+)?(?:he\s+)?(?:llamado|terminado|completado|hecho)\s+(?:a\s+)?/i, "")
    .replace(/[.!?,;]+$/g, "")
    .trim();
  return cleaned || null;
}

function isCompletable(entry) {
  if (!entry || entry.status === "done" || !COMPLETABLE_TYPES.has(entry.type)) return false;
  return !["cancelled", "completed"].includes(entry.interaction?.status);
}

function matchScore(entry, tokens) {
  const searchable = normalize([
    entry.text,
    entry.aiIntent?.title,
    entry.aiIntent?.contactName,
    entry.contactQuery,
    entry.schedule?.title
  ].filter(Boolean).join(" "));
  return tokens.reduce((score, token) => score + (searchable.includes(token) ? 1 : 0), 0) / tokens.length;
}

function meaningfulTokens(value) {
  return normalize(value).split(" ").filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function recent(entry) {
  return String(entry.updatedAt || entry.date || "");
}
