// Coordina acciones sobre resultados existentes, sin cambiar la consulta ni OAuth.
export function createAgendaActions({google, onDeleted, showList, showWorking}) {
  let busy = false;
  return async function cancelFromList(note, eventId) {
    if (busy || note.proposal?.intent !== 'calendar.query') return;
    const result = google.getCalendarResult(note.id);
    if (!result?.events?.some(event => event.id === eventId)) return;
    busy = true;
    try {
      await google.deleteCalendarEvent(note, eventId);
      // La integración invalida el resultado únicamente tras un DELETE correcto.
      // Rechazar la confirmación o un error conserva el resultado original.
      if (!google.getCalendarResult(note.id)) {
        await onDeleted(eventId);
        showWorking();
        await google.searchCalendar(note);
      }
    } finally {
      busy = false;
      showList(note);
    }
  };
}

// Respuesta directa a una pregunta de agenda, para leerla en voz alta y ponerla
// arriba del resultado: «La cena con Vicente es el sábado 26 de septiembre a las
// 21:00, en Casa Pepe.» o «Mañana tienes 2 cosas: …». Antes solo había una lista
// con el texto genérico «Angeli ha entendido esto».
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

export function spokenWhen(event, now = new Date()) {
  const start = event.allDay ? new Date(`${String(event.start).slice(0, 10)}T12:00:00`) : new Date(event.start);
  if (Number.isNaN(start.getTime())) return event.when || "";
  const days = Math.round((startOfDay(start) - startOfDay(now)) / 86400000);
  const day = days === 0 ? "hoy" : days === 1 ? "mañana" : days === 2 ? "pasado mañana"
    : `el ${DAYS[start.getDay()]} ${start.getDate()} de ${MONTHS[start.getMonth()]}${start.getFullYear() !== now.getFullYear() ? ` de ${start.getFullYear()}` : ""}`;
  if (event.allDay) return `${day}, todo el día`;
  return `${day} a las ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
}

// Resumen del día, la primera vez que se abre Angeli cada día. Los avisos
// que Angeli crea junto a un evento no se cuentan dos veces.
export function dayBriefing(events = [], now = new Date()) {
  const hour = now.getHours();
  const greeting = hour < 14 ? "Buenos días" : hour < 21 ? "Buenas tardes" : "Buenas noches";
  const items = events.filter(event => !event.relatedEventId);
  const later = hour < 14 ? "Hoy" : "Lo que queda de hoy";
  if (!items.length) return `${greeting}. ${hour < 14 ? "Hoy no tienes nada en la agenda" : "No te queda nada más en la agenda por hoy"}.`;
  const when = event => event.allDay ? "todo el día" : `a las ${String(event.start).slice(11, 16)}`;
  const item = event => `«${event.summary}» ${when(event)}`;
  if (items.length === 1) return `${greeting}. ${later} tienes ${item(items[0])}.`;
  if (items.length <= 4) return `${greeting}. ${later} tienes ${items.length} cosas: ${items.slice(0, -1).map(item).join(", ")} y ${item(items[items.length - 1])}.`;
  return `${greeting}. ${later} tienes ${items.length} cosas. La primera, ${item(items[0])}.`;
}

// Aviso cuando el evento nuevo coincide con algo que ya está en la agenda.
// Se dice en voz alta en el modo conversación, así que va en frase natural.
export function clashWarning(events = []) {
  if (!events.length) return "";
  const item = event => `«${event.summary}» a las ${String(event.start).slice(11, 16)}`;
  if (events.length === 1) return `Ojo: a esa hora ya tienes ${item(events[0])}. ¿Lo añado igual?`;
  return `Ojo: a esa hora ya tienes ${events.length} cosas: ${events.slice(0, -1).map(item).join(", ")} y ${item(events[events.length - 1])}. ¿Lo añado igual?`;
}

export function calendarAnswer(interpretation = {}, result = {}, now = new Date()) {
  const events = result?.events || [];
  const topic = interpretation.target?.title || "";
  const hasPeriod = Boolean(interpretation.rangeStart);
  if (topic) {
    if (!events.length) return `No encuentro nada sobre «${topic}» ${hasPeriod ? "en ese periodo" : "en tu agenda de los próximos tres meses"}.`;
    const [first] = events;
    const where = first.location ? `, en ${first.location}` : "";
    const more = events.length > 1 ? ` También hay ${events.length - 1} más.` : "";
    return `«${first.summary}» es ${spokenWhen(first, now)}${where}.${more}`;
  }
  if (!events.length) return "No tienes nada en ese periodo.";
  const item = event => `«${event.summary}» ${spokenWhen(event, now)}`;
  if (events.length === 1) return `Tienes una cosa: ${item(events[0])}.`;
  if (events.length <= 3) return `Tienes ${events.length} cosas: ${events.slice(0, -1).map(item).join("; ")} y ${item(events[events.length - 1])}.`;
  return `Tienes ${events.length} cosas. La primera, ${item(events[0])}.`;
}
