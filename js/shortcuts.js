import { contactQuery } from "./classifier.js?v=0.26.7";
import { naturalQueryRange, temporalData } from "./temporal.js?v=0.26.7";
import { REMINDER_SHORTCUT_TRIGGER } from "./keywords.js?v=0.26.7";

// Los accesos por defecto llevan un `id` fijo (no generado al vuelo) para
// que dos dispositivos que arrancan sin nada guardado todavía — y por tanto
// caen los dos en DEFAULT_SHORTCUTS como base — terminen de acuerdo en qué
// id le corresponde a cada uno. Si el id se generase al azar en cada
// normalizeShortcuts(), la fusión con la nube (ver mergeShortcuts) los
// trataría como accesos distintos y los duplicaría en cuanto sincronizasen.
export const DEFAULT_SHORTCUTS = [
  { id: "default-hoy", label: "🗓️ Hoy", command: "¿Qué tengo hoy?", action: "calendar.query", direct: true },
  { id: "default-proxima-semana", label: "🗓️ Próxima semana", command: "¿Qué tengo la semana que viene?", action: "calendar.query", direct: true },
  { id: "default-llamar-contacto", label: "📞 Llamar contacto", prompt: "Di el nombre del contacto.", prefix: "Llama a ", dictate: true, action: "contact.call", direct: true },
  { id: "default-whatsapp", label: "💬 WhatsApp", prompt: "Di el contacto y el mensaje.", prefix: "Envía un WhatsApp a ", dictate: true, action: "whatsapp.compose" },
  { id: "default-nuevo-evento", label: "＋ Nuevo evento", prompt: "Cuéntame el evento: fecha, hora y lugar.", prefix: "Añade al calendario ", action: "calendar.create" },
  { id: "default-recordatorio", label: "⏰ Recordatorio", prompt: "¿Qué quieres que te recuerde y cuándo?", prefix: "Recuérdame ", action: "reminder.create" },
  { id: "default-cancelar-evento", label: "✕ Cancelar evento", prompt: "¿Qué evento quieres cancelar?", prefix: "Cancela ", action: "calendar.delete", direct: true }
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

const makeShortcutId = () => `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function normalizeShortcuts(saved) {
  const source = Array.isArray(saved) ? saved : DEFAULT_SHORTCUTS;
  return source.map(shortcut => ({ ...shortcut, ...shortcutSemantics(shortcut), id: shortcut?.id || makeShortcutId() }));
}

// Real reportado: dos móviles con Angeli abierto a la vez y cada uno tocando
// sus accesos directos (uno crea uno nuevo, el otro borra otro) — como el
// guardado en la nube era un setDoc() que sobrescribía el documento entero,
// el que guardaba en segundo lugar borraba sin avisar el cambio del primero.
// La solución no puede ser "fusionar objetos": sin un id estable no hay
// forma de saber si dos accesos distintos son "el mismo, editado" o son dos
// accesos distintos que coinciden por casualidad, así que ahora cada acceso
// lleva su `id` (ver normalizeShortcuts) y la fusión se hace por id:
// diffShortcuts() calcula qué cambió en ESTE dispositivo desde la última vez
// que se sincronizó (altas, bajas, ediciones y el orden deseado), y
// applyShortcutsDiff() aplica exactamente esos cambios sobre la copia más
// reciente que haya en la nube — así un acceso añadido en el otro móvil
// mientras este estaba editando el suyo no se pierde, y viceversa.
export function diffShortcuts(before = [], after = []) {
  const beforeById = new Map(before.filter(item => item?.id).map(item => [item.id, item]));
  const afterById = new Map(after.filter(item => item?.id).map(item => [item.id, item]));
  const removed = before.filter(item => item?.id && !afterById.has(item.id)).map(item => item.id);
  const added = after.filter(item => item?.id && !beforeById.has(item.id));
  const edited = after.filter(item => {
    const prior = item?.id ? beforeById.get(item.id) : null;
    return prior && JSON.stringify(prior) !== JSON.stringify(item);
  });
  const order = after.filter(item => item?.id).map(item => item.id);
  return { removed, added, edited, order };
}

export function applyShortcutsDiff(remote = [], diff) {
  const removedIds = new Set(diff.removed);
  let result = remote.filter(item => !removedIds.has(item.id));
  result = result.map(item => diff.edited.find(edit => edit.id === item.id) || item);
  const presentIds = new Set(result.map(item => item.id));
  for (const item of diff.added) {
    if (presentIds.has(item.id)) result = result.map(existing => (existing.id === item.id ? item : existing));
    else { result.push(item); presentIds.add(item.id); }
  }
  const orderIndex = new Map(diff.order.map((id, index) => [id, index]));
  return result.slice().sort((a, b) => (orderIndex.has(a.id) ? orderIndex.get(a.id) : Infinity) - (orderIndex.has(b.id) ? orderIndex.get(b.id) : Infinity));
}

export function shortcutSemantics(shortcut = {}) {
  shortcut = shortcut || {};
  if (shortcut.action) return { action: shortcut.action, direct: Boolean(shortcut.direct) };
  const value = `${shortcut.label || ""} ${shortcut.command || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(?:cancelar|cancela|anular|anula|borrar evento)\b/.test(value)) return { action: "calendar.delete", direct: true };
  if (REMINDER_SHORTCUT_TRIGGER.test(value)) return { action: "reminder.create", direct: false };
  // WhatsApp NO es directo a propósito: sin un marcador claro de mensaje
  // ("dile"/"diciéndole"), separar el contacto del texto del mensaje es poco
  // fiable en local ("a Ana que llego tarde" -> el contacto se comería el
  // mensaje). La IA lo separa bien, así que este pasa por ella. Llamar y
  // consultar/cancelar agenda sí son directos: no hay mensaje que separar.
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
  // 3ª auditoría (atajo directo, sin IA): «Llama a» a secas buscaba el
  // contacto «a»; «Llama a Ana al móvil» buscaba «Ana al móvil»; un número se
  // trataba como nombre; y «Llama a Ana mañana a las 10» perdía la fecha y
  // llamaba ya. Ahora el nombre se limpia, un número va a `phone`, un nombre
  // vacío se pregunta, y con fecha/hora normalizeFutureCall lo convierte en aviso.
  if (action === "contact.call") {
    const raw = String(interpretation.contactName || contactQuery(text) || cleanInstruction(text, "contact.call") || "").replace(/\s+(?:para|que|porque|al\s+(?:m[oó]vil|fijo|trabajo)|a\s+las?\b|ma[nñ]ana|hoy|esta\s+(?:tarde|noche)).*$/i, "").trim();
    const phone = /^[+\d][\d\s().-]{7,}$/.test(raw) ? raw.replace(/[^\d+]/g, "") : (interpretation.phone || null);
    const contactName = phone && !interpretation.contactName ? null : (raw.length >= 2 ? raw : null);
    return { ...base, date: temporal.scheduledDate || null, time: temporal.scheduledTime || null, contactName, phone, requiresConfirmation: true, missingFields: contactName || phone ? [] : ["contactName"] };
  }
  if (action === "whatsapp.compose") return { ...base, date: null, time: null, contactName: interpretation.contactName || contactQuery(text) || null, requiresConfirmation: true };
  // 3ª auditoría: el acceso directo de agenda ya no pasa por la IA, así que
  // debe entender todos los periodos que sí entiende el respaldo local («los
  // próximos 3 días», «este mes», «el fin de semana»), no solo semana/día.
  if (action === "calendar.query") return { ...base, ...(naturalQueryRange(text, now) || {}), requiresConfirmation: false, missingFields: [] };
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
    // «Cancela» a secas (sin nada detrás) debe quedar vacío y preguntarse, no
    // buscar el evento «Cancela».
    "calendar.delete": /^\s*(?:(?:cancela(?:r)?|anula(?:r)?|borra(?:r)?)(?:\s+(?:el\s+|la\s+|lo\s+de\s+)?|\s*$))+/i
  };
  return String(text || "").replace(prefixes[action] || /^$/, "").trim() || null;
}
