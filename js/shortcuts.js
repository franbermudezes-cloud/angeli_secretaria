import { contactQuery } from "./classifier.js?v=0.22.7";
import { calendarQueryRange, temporalData } from "./temporal.js?v=0.22.7";

export const DEFAULT_SHORTCUTS = [
  { label: "🗓️ Hoy", command: "¿Qué tengo hoy?", action: "calendar.query", direct: true },
  { label: "🗓️ Próxima semana", command: "¿Qué tengo la semana que viene?", action: "calendar.query", direct: true },
  { label: "📞 Llamar contacto", prompt: "Di el nombre del contacto.", prefix: "Llama a ", dictate: true, action: "contact.call", direct: true },
  { label: "💬 WhatsApp", prompt: "Di el contacto y el mensaje.", prefix: "Envía un WhatsApp a ", dictate: true, action: "whatsapp.compose" },
  { label: "＋ Nuevo evento", prompt: "Cuéntame el evento: fecha, hora y lugar.", prefix: "Añade al calendario ", action: "calendar.create" },
  { label: "⏰ Recordatorio", prompt: "¿Qué quieres que te recuerde y cuándo?", prefix: "Recuérdame ", action: "reminder.create" },
  { label: "✕ Cancelar evento", prompt: "¿Qué evento quieres cancelar?", prefix: "Cancela ", action: "calendar.delete", direct: true }
];

// Pedido explícito del propietario: "como había antes, que pudiera elegir
// ya accesos directos con su icono y todo ya puesto" — en vez de escribir
// el texto y buscar un icono a mano cada vez (el viejo flujo con prompt()),
// se elige uno de esta lista ya lista para usar. Incluye los mismos
// DEFAULT_SHORTCUTS (por si se borró alguno desde "Gestionar accesos
// directos" y se quiere recuperar tal cual) más unos cuantos más para
// funciones que ya existen en la app pero no tenían acceso propio.
export const SHORTCUT_PRESETS = [
  ...DEFAULT_SHORTCUTS,
  { label: "📝 Nueva nota", prompt: "Escribe o dicta la nota.", prefix: "", action: "note" },
  { label: "🛒 Añadir a la compra", prompt: "Di qué artículo añadir a la lista.", prefix: "Añade a la lista de la compra ", dictate: true },
  { label: "🗓️ Mañana", command: "¿Qué tengo mañana?", action: "calendar.query", direct: true },
  { label: "🗓️ Esta semana", command: "¿Qué tengo esta semana?", action: "calendar.query", direct: true }
];

export function normalizeShortcuts(saved) {
  const source = Array.isArray(saved) ? saved : DEFAULT_SHORTCUTS;
  return source.map(shortcut => ({ ...shortcut, ...shortcutSemantics(shortcut) }));
}

export function shortcutSemantics(shortcut = {}) {
  shortcut = shortcut || {};
  if (shortcut.action) return { action: shortcut.action, direct: Boolean(shortcut.direct) };
  const value = `${shortcut.label || ""} ${shortcut.command || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(?:cancelar|cancela|anular|anula|borrar evento)\b/.test(value)) return { action: "calendar.delete", direct: true };
  if (/\b(?:recordatorio|recuerdame|avisame)\b/.test(value)) return { action: "reminder.create", direct: false };
  if (/\bwhats?app\b/.test(value)) return { action: "whatsapp.compose", direct: false };
  if (/\b(?:llamar|llama|telefono|contacto)\b/.test(value)) return { action: "contact.call", direct: true };
  if (/\b(?:que tengo|agenda|calendario|citas?)\b/.test(value)) return { action: "calendar.query", direct: true };
  if (/\b(?:nuevo evento|crear evento|anadir evento)\b/.test(value)) return { action: "calendar.create", direct: false };
  return { action: null, direct: false };
}

export function shortcutPrefix(shortcut = {}) {
  shortcut = shortcut || {};
  if (shortcut.prefix) return shortcut.prefix;
  return { "contact.call": "Llama a ", "whatsapp.compose": "Envía un WhatsApp a ", "reminder.create": "Recuérdame ", "calendar.create": "Añade al calendario ", "calendar.delete": "Cancela " }[shortcut.action] || "";
}

export function shortcutType(shortcut = {}) {
  shortcut = shortcut || {};
  return { "contact.call": "contact", "whatsapp.compose": "contact", "reminder.create": "reminder", "calendar.create": "calendar", "calendar.query": "calendar", "calendar.delete": "calendar" }[shortcut.action] || null;
}

export function routeShortcutIntent(interpretation, shortcut, text, now = new Date()) {
  const action = shortcut?.action;
  if (!action) return interpretation;
  const forced = interpretation.intent !== action;
  const temporal = temporalData(text, now, { inferDateFromTime: action === "reminder.create" });
  const date = interpretation.date || temporal.scheduledDate || null;
  const time = interpretation.time || temporal.scheduledTime || null;
  const base = { ...interpretation, intent: action, date, time, question: null };
  if (action === "contact.call") return { ...base, date: null, time: null, contactName: interpretation.contactName || contactQuery(text) || null, requiresConfirmation: true, missingFields: [] };
  if (action === "whatsapp.compose") return { ...base, date: null, time: null, contactName: interpretation.contactName || contactQuery(text) || null, requiresConfirmation: true };
  if (action === "calendar.query") return { ...base, ...(calendarQueryRange(text, now) || {}), requiresConfirmation: false, missingFields: [] };
  if (action === "calendar.delete") {
    const title = interpretation.target?.title || cleanInstruction(text, action) || interpretation.title;
    return { ...base, target: title ? { title, date, time } : null, requiresConfirmation: true, missingFields: title ? [] : ["target"] };
  }
  if (action === "calendar.create") return { ...base, title: forced ? cleanInstruction(text, action) : interpretation.title || cleanInstruction(text, action), requiresConfirmation: true, missingFields: [] };
  if (action === "reminder.create") return { ...base, title: forced ? cleanInstruction(text, action) : interpretation.title || cleanInstruction(text, action), requiresConfirmation: Boolean(date && time), missingFields: [] };
  return base;
}

function cleanInstruction(text, action) {
  const prefixes = {
    "contact.call": /^\s*(?:(?:llama(?:r)?|telefonea(?:r)?|contacta(?:r)?)\s+(?:a\s+)?)+/i,
    "reminder.create": /^\s*(?:(?:recu[eé]rdame|recordar|av[ií]same)\s+)+/i,
    "calendar.create": /^\s*(?:(?:a[nñ]ade|agrega|crea)\s+(?:un\s+evento\s+)?(?:al\s+calendario\s+)?)+/i,
    "calendar.delete": /^\s*(?:(?:cancela(?:r)?|anula(?:r)?|borra(?:r)?)\s+(?:el\s+|la\s+)?)+/i
  };
  return String(text || "").replace(prefixes[action] || /^$/, "").trim() || null;
}
