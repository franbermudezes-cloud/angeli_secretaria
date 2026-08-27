import { fromCloudEntry, toCloudEntry } from '../js/cloud-entry.js';
import { calendarEvent, scheduledReminderEvent } from '../js/google.js';
import { scheduleFor, updateCalendarDetails } from '../js/schedule.js';

const eventId=crypto.randomUUID(),reminderId=crypto.randomUUID();
const event=fromCloudEntry(toCloudEntry({
  id:eventId,type:'calendar',text:'Cena con María mañana a las nueve en San Marcos de Gandía',
  scheduledDate:'2026-08-28',scheduledTime:'21:00',calendarTitle:'Cena con María',
  calendarDescription:'Preparar el aniversario',location:'San Marcos de Gandía',
  aiIntent:{intent:'calendar.create',title:'Cena con María',notes:null}
},'2026-08-27T12:00:00.000Z'),eventId);

const text='Tengo que quedar con Miguel mañana a las nueve';
const aiIntent={intent:'reminder.create',title:'Quedar con Miguel',contactName:'Miguel',date:'2026-08-28',time:'09:00',notes:null};
const reminder=fromCloudEntry(toCloudEntry(updateCalendarDetails({
  id:reminderId,type:'reminder',text,aiIntent,schedule:scheduleFor(aiIntent,text)
},'description','Llevar el presupuesto'),'2026-08-27T12:00:00.000Z'),reminderId);

console.log(JSON.stringify([
  {kind:'event',expected:'Preparar el aniversario',event:calendarEvent(event)},
  {kind:'reminder',expected:'Llevar el presupuesto',event:scheduledReminderEvent(reminder)}
]));
