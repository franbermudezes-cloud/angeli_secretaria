// Transcripción real reportada; respuesta IA parcial controlada para reproducir
// la pérdida del nombre. No usa micrófono ni invoca Gemini.
import { scheduleFor, scheduleTitle } from '../js/schedule.js';
import { scheduledReminderEvent } from '../js/google.js';

export function reminderFixture() {
  const text = 'Recuérdame llamar a Miguel Ibiza mañana a las diez de la mañana';
  const aiIntent = {intent:'reminder.create', title:'Llamar a contacto',
    contactName:null, phone:null, date:'2026-08-27', time:'10:00',
    notes:'Confirmar presupuesto'};
  return {id:crypto.randomUUID(), type:'reminder', text, aiIntent,
    schedule:scheduleFor(aiIntent,text)};
}

export function fixtureTitle() { return scheduleTitle(reminderFixture()); }

// El arnés Python consume exactamente el payload que envía la PWA.
if (typeof process !== 'undefined' && process.argv.includes('--calendar-payload')) {
  console.log(JSON.stringify(scheduledReminderEvent(reminderFixture())));
}
