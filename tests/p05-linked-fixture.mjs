import { localLinkedCalendarIntent } from '../js/ai.js';
import { linkedScheduleFor } from '../js/schedule.js';
import { calendarEvent, scheduledReminderEvent } from '../js/google.js';

const text='Tenemos una boda el 14 de septiembre a las seis en la Masía X. Recuérdame dos días antes comprobar el equipo.';
const interpretation=localLinkedCalendarIntent(text,new Date(2026,7,27,12));
if(!interpretation)throw new Error('P05 no produjo una operación compuesta');
const note={id:'p05linkedfixture',text,type:'calendar',scheduledDate:interpretation.date,scheduledTime:interpretation.time,location:interpretation.location,calendarTitle:interpretation.title,aiIntent:interpretation,proposal:{intent:'calendar.create'},calendarStatus:'pending',schedule:linkedScheduleFor(interpretation)};
process.stdout.write(JSON.stringify({interpretation,event:calendarEvent(note),reminder:scheduledReminderEvent(note)}));
