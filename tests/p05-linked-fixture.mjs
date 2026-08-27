import { localLinkedCalendarIntent } from '../js/ai.js';
import { linkedScheduleFor } from '../js/schedule.js';
import { calendarEvent, scheduledReminderEvent } from '../js/google.js';
import { resolveConversationTurn } from '../js/conversation.js';

const text='Disco móvil para el día 5 de septiembre en el Complejo San Marcos de Gandía. Tienes que avisarme un día antes para ir a montar el equipo.';
const initial=localLinkedCalendarIntent(text,new Date(2026,7,27,12));
if(!initial)throw new Error('P05 no produjo una operación compuesta');
const first=resolveConversationTurn({text,interpretation:initial,now:'2026-08-27T12:00:00.000Z'});
const active={id:'p05linkedfixture',text,aiIntent:first.interpretation,interaction:first.interaction};
const interpretation=resolveConversationTurn({active,text:'A las seis de la tarde',interpretation:{...initial,time:'18:00',linkedReminder:null,missingFields:[],question:null,source:'fallback'},now:'2026-08-27T12:01:00.000Z'}).interpretation;
const note={id:'p05linkedfixture',text,type:'calendar',scheduledDate:interpretation.date,scheduledTime:interpretation.time,location:interpretation.location,calendarTitle:interpretation.title,aiIntent:interpretation,proposal:{intent:'calendar.create'},calendarStatus:'pending',schedule:linkedScheduleFor(interpretation)};
process.stdout.write(JSON.stringify({initial,interpretation,event:calendarEvent(note),reminder:scheduledReminderEvent(note)}));
