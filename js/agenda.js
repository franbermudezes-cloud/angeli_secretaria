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
