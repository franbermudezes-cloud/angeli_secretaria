import { normalizeReminderSchedule, scheduleFor } from '../js/schedule.js';
import { scheduledReminderEvent } from '../js/google.js';
const now = new Date(2026,7,26,12);
const cases = [['mañana','2026-08-27'],['pasado mañana','2026-08-28']].map(([phrase,expected])=>{
  const text=`Recuérdame llamar a Carlos Ferrer ${phrase} a las once de la mañana`;
  const aiIntent=normalizeReminderSchedule({intent:'reminder.create',title:'Llamar a Carlos Ferrer',contactName:'Carlos Ferrer',date:'2026-08-27',time:'11:00'},text,now);
  const note={id:crypto.randomUUID(),text,aiIntent,schedule:scheduleFor(aiIntent,text)};
  return {expected, event:scheduledReminderEvent(note)};
});
console.log(JSON.stringify(cases));
