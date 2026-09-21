import { calendarDetails, scheduleTitle } from "./schedule.js?v=0.23.0";
import { noteTitle } from "./notes.js?v=0.23.0";
import { typeLabel } from "./classifier.js?v=0.23.0";

/** Tipo visual (color/rail) usado en el Dietario para agrupar entradas afines. */
const RAIL_BY_TYPE = { calendar: "calendar", reminder: "reminder", task: "reminder", contact: "reminder", note: "note", photo: "attach", file: "attach" };

function entryDateKey(entry) {
  if (entry.schedule?.dueAt) return entry.schedule.dueAt.slice(0, 10);
  if (entry.scheduledDate) return entry.scheduledDate;
  return null;
}

function entryTimeLabel(entry) {
  const time = entry.schedule?.dueAt ? entry.schedule.dueAt.slice(11, 16) : entry.scheduledTime;
  return time || "";
}

function entryTitle(entry) {
  if (entry.type === "calendar") return calendarDetails(entry).title;
  if (entry.schedule) return scheduleTitle(entry);
  if (entry.type === "note") return noteTitle(entry);
  return (entry.aiIntent?.title || entry.text || typeLabel(entry.type)).trim();
}

// Una entrada activa es la que aún merece un hueco en el Dietario: una nota o
// tarea sin marcar como hecha, un aviso no cancelado ni completado, o un
// evento de Calendar que no haya fallado al crearse.
//
// Consultar la agenda ("¿Qué tengo la semana que viene?", incluidos los
// accesos "Hoy"/"Próxima semana") no es un evento: es una pregunta que deja
// una entrada permanente sin fecha, sin calendarStatus (ese campo solo lo
// lleva calendar.create) y que nunca se marca como hecha, así que sin este
// filtro se acumulaba sin límite en "Sin fecha" cada vez que se repetía la
// misma pregunta. No es lo mismo que note.query/reminder.query, que nunca
// llegan a guardarse como entrada.
function entryActive(entry) {
  if (entry.type === "calendar" && entry.aiIntent?.intent === "calendar.query") return false;
  if (entry.schedule) return !["cancelled", "completed"].includes(entry.schedule.status);
  if (entry.type === "calendar") return entry.calendarStatus !== "error";
  return entry.status !== "done";
}

/** Normaliza cada entrada de Firestore a la forma que necesita el Dietario, sin tocar los datos originales. */
export function dietarioEntries(notes = []) {
  return notes.filter(entryActive).map(entry => {
    const dateKey = entryDateKey(entry), time = entryTimeLabel(entry);
    return {
      id: entry.id,
      type: entry.type,
      rail: RAIL_BY_TYPE[entry.type] || "note",
      title: entryTitle(entry),
      dateKey,
      time,
      dated: Boolean(dateKey),
      attachmentCount: (entry.images || []).length + (entry.files || []).length,
      subtitle: entry.location || entry.mediaContext?.categoryLabel || entry.noteClassification?.categoryLabel || "",
      sortKey: `${dateKey || "9999-99-99"}T${time || "99:99"}`
    };
  });
}

function toDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }

export function dietarioDayLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  return {
    weekday: date.toLocaleDateString("es-ES", { weekday: "short" }).replace(/\.$/, ""),
    day: date.toLocaleDateString("es-ES", { day: "numeric", month: "short" })
  };
}

// Agrupa por día como una agenda de papel: solo hoy en adelante (el pasado ya
// se resolvió), con un horizonte según el rango elegido y una sección final
// para lo que aún no tiene fecha, igual que las notas sueltas al final del
// dietario. No crea ningún dato: solo agrupa lo que Angeli ya tiene guardado.
//
// Pedido explícito del propietario: "Hoy"/"Esta semana"/"Todo" solo miran
// hacia delante (dateKey >= hoy), así que algo con fecha pasada que sigue
// activo (un aviso que no se llegó a cancelar ni completar, un evento sin
// marcar) no aparecía en NINGÚN filtro — se perdía sin que nadie lo viera.
// El rango "pending" es justo para eso: en vez de mirar hacia delante, mira
// hacia atrás (dateKey < hoy), de más reciente a más antiguo, para que lo
// atrasado no quede invisible. Se suma la misma sección "sin fecha" que ya
// llevan el resto de rangos, porque también es "pendiente" en el sentido
// que pide el propietario ("pendientes o anteriores").
export function groupDietarioByDay(notes, { now = new Date(), range = "week", type = "all" } = {}) {
  const items = dietarioEntries(notes).filter(item => type === "all" || item.rail === type);
  const todayKey = toDateKey(now);
  const isPending = range === "pending";
  const endKey = range === "today" ? todayKey : range === "week" ? toDateKey(addDays(now, 7)) : null;
  const dated = isPending
    ? items.filter(item => item.dated && item.dateKey < todayKey)
    : items.filter(item => item.dated && item.dateKey >= todayKey && (endKey === null || item.dateKey <= endKey));
  const undated = items.filter(item => !item.dated).sort((a, b) => a.title.localeCompare(b.title, "es"));
  const byDay = new Map();
  const sortedDated = dated.sort((a, b) => isPending ? b.sortKey.localeCompare(a.sortKey) : a.sortKey.localeCompare(b.sortKey));
  for (const item of sortedDated) {
    if (!byDay.has(item.dateKey)) byDay.set(item.dateKey, []);
    byDay.get(item.dateKey).push(item);
  }
  const days = [...byDay.entries()].map(([dateKey, dayItems]) => ({
    dateKey, isToday: dateKey === todayKey, label: dietarioDayLabel(dateKey), items: dayItems
  }));
  return { days, undated };
}
