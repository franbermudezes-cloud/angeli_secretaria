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
