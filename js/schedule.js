import{nextDateForTime,temporalData,explicitRelativeDate}from"./temporal.js?v=0.21.37";

const CALL_INTENT=/\b(?:llama|llamar|telefonea|telefonear|contacta|contactar)\b/i;

// Una orden nueva de llamada sin tiempo no es un recordatorio por defecto.
// No aplicar a respuestas cortas dentro de una programación ya iniciada.
export function normalizeUndatedCall(interpretation,text,active=null,now=new Date()){
  if(active || !/^\s*(?:(?:quiero|necesito)\s+)?(?:llama|llamar|telefonea|telefonear)\s+(?:a\s+|al\s+)?\S/i.test(text||''))return interpretation;
  const local=temporalData(text,now);
  if(/\b(?:horas?|minutos?|segundos?|días?|dias?|cuando|tras)\b|\bel\s+\d|\d[/-]\d/i.test(text))return interpretation;
  if(local.scheduledDate||local.scheduledTime||/\b(?:recuerd|record|avis|agend|program|luego|después|despues|tarde|noche|semana|mes|dentro|próxim|proxim|lunes|martes|jueves|viernes|domingo)\w*\b|miércoles|sábado|\d{4}-\d{2}-\d{2}/i.test(text))return interpretation;
  if(!['contact.call','reminder.create','calendar.create','note'].includes(interpretation.intent))return interpretation;
  const name=callName(text.replace(/\s+(?:ahora(?:\s+mismo)?|ya|por favor)[.!?]*\s*$/i,''));
  return {...interpretation,intent:'contact.call',title:`Llamar a ${name||interpretation.contactName||interpretation.phone||'contacto'}`,
    contactName:name||interpretation.contactName||null,date:null,time:null,missingFields:[],question:null,requiresConfirmation:true};
}

export function deferredCallIntent(note,intent){
  if(!['reminder.create','calendar.create'].includes(intent))throw new Error('Destino de llamada no válido');
  return {...note.aiIntent,intent,date:null,time:null,missingFields:['date','time'],
    question:'¿Qué día y a qué hora quieres llamar?',requiresConfirmation:true};
}

export function normalizeFutureCall(interpretation,text){
  // Cualquier referencia temporal cambia la intención: «llama a Miguel» es
  // inmediata, pero «llama a Miguel mañana» o «a las siete» es un aviso que
  // puede necesitar completar el dato temporal que falta.
  if(interpretation?.intent!=="contact.call"||(!interpretation.date&&!interpretation.time))return interpretation;
  const contactName=interpretation.contactName||null;
  return{...interpretation,intent:"reminder.create",title:interpretation.title||`Llamar a ${contactName||interpretation.phone||"contacto"}`,requiresConfirmation:true};
}

// El intérprete recibe la hora actual, pero este refuerzo protege también el
// fallback local y cualquier respuesta parcial. Para un recordatorio, una hora
// sin día significa la próxima ocurrencia posible, no una fecha inventada.
export function normalizeReminderSchedule(interpretation,text,now=new Date()){
  if(interpretation?.intent!=="reminder.create")return interpretation;
  const local=temporalData(text,now,{inferDateFromTime:true});
  const time=interpretation.time||local.scheduledTime||null;
  const date=explicitRelativeDate(text,now)||interpretation.date||local.scheduledDate||(time?dateKey(nextDateForTime(time,now)):null);
  return{...interpretation,date,time,requiresConfirmation:Boolean(date&&time)};
}

export function scheduleFor(interpretation,text){
  if(interpretation?.intent!=="reminder.create"||!interpretation.date||!interpretation.time)return null;
  // Que exista una persona no convierte por sí solo el recordatorio en llamada:
  // «quedar con Miguel» debe conservar ese título y esa clase de acción.
  const call=CALL_INTENT.test(text||"")||CALL_INTENT.test(interpretation.title||"")||Boolean(interpretation.phone);
  return{
    dueAt:`${interpretation.date}T${interpretation.time}:00`,
    timeZone:"Europe/Madrid",
    action:{kind:call?"contact.call":"reminder",contactName:call?(usableName(interpretation.contactName)||callName(interpretation.title)||callName(text)):null,phone:interpretation.phone||null},
    status:"pending_confirmation",
    delivery:{calendar:"pending",android:"pending"},
    calendarEventId:null,
    calendarUrl:null,
    externalJobId:null,
    lastError:null
  };
}

export function linkedScheduleFor(interpretation){
  const reminder=interpretation?.linkedReminder;
  if(interpretation?.intent!=="calendar.create"||!reminder?.date||!reminder?.time)return null;
  return{dueAt:`${reminder.date}T${reminder.time}:00`,timeZone:"Europe/Madrid",title:reminder.title,description:reminder.notes||"",action:{kind:"reminder",contactName:null,phone:null},status:"pending_confirmation",delivery:{calendar:"pending",android:"pending"},calendarEventId:null,calendarUrl:null,relatedEventId:null,externalJobId:null,lastError:null};
}

export function scheduleTitle(note){
  const explicit=String(note.schedule?.title||"").trim();
  if(explicit)return explicit;
  const action=note.schedule?.action||{};
  if(action.kind==="contact.call"){
    const name=usableName(action.contactName)||usableName(note.aiIntent?.contactName)||callName(note.aiIntent?.title)||callName(note.text);
    if(name||action.phone)return`Llamar a ${name||action.phone}`;
    // No desechar la instrucción original si no pudimos separar el nombre.
    return(note.text||note.aiIntent?.title||"Llamar a contacto").trim();
  }
  return(note.aiIntent?.title||note.text||"Recordatorio").trim();
}

// Ficha única de confirmación para eventos y avisos. Estos mismos campos son
// los que se envían después a Calendar: la pantalla no muestra una aproximación.
export function calendarDetails(note){
  const reminder=Boolean(note.schedule)&&note.proposal?.intent!=="calendar.create";
  return{
    title:reminder?scheduleTitle(note):String(note.calendarTitle||note.aiIntent?.title||note.text||"Evento").trim(),
    description:String(reminder?note.schedule?.description??note.aiIntent?.notes??"":note.calendarDescription??note.aiIntent?.notes??"").trim(),
    location:String(note.location||note.aiIntent?.location||"").trim(),
    when:reminder?scheduleWhen(note.schedule):eventWhen(note.scheduledDate||note.aiIntent?.date,note.scheduledTime||note.aiIntent?.time)
  };
}

export function updateCalendarDetails(note,field,value){
  const clean=String(value||"").trim();
  if(field==="reminderTitle"&&note.schedule)return{...note,schedule:{...note.schedule,title:clean}};
  if(field==="location")return{...note,location:clean,aiIntent:{...note.aiIntent,location:clean||null}};
  if(!["title","description"].includes(field))return note;
  if(note.schedule&&note.proposal?.intent==="calendar.create")return{...note,[field==="title"?"calendarTitle":"calendarDescription"]:clean};
  if(note.schedule)return{...note,schedule:{...note.schedule,[field]:clean}};
  return{...note,[field==="title"?"calendarTitle":"calendarDescription"]:clean};
}

export function updateCalendarDateTime(note,date,time){
  const nextDate=String(date||"").trim(),nextTime=String(time||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)||!/^\d{2}:\d{2}$/.test(nextTime))return note;
  const nextValue=new Date(`${nextDate}T${nextTime}:00`);
  if(Number.isNaN(nextValue.getTime()))return note;
  const reminder=Boolean(note.schedule)&&note.proposal?.intent!=="calendar.create";
  if(reminder)return{...note,scheduledDate:nextDate,scheduledTime:nextTime,aiIntent:{...note.aiIntent,date:nextDate,time:nextTime},schedule:{...note.schedule,dueAt:`${nextDate}T${nextTime}:00`}};
  let schedule=note.schedule;
  if(schedule?.dueAt){
    const oldEvent=wallClockMs(`${note.scheduledDate||note.aiIntent?.date}T${note.scheduledTime||note.aiIntent?.time}:00`),oldReminder=wallClockMs(schedule.dueAt),nextEvent=wallClockMs(`${nextDate}T${nextTime}:00`);
    if([oldEvent,oldReminder,nextEvent].every(Number.isFinite)){
      schedule={...schedule,dueAt:wallClockDateTime(new Date(nextEvent-(oldEvent-oldReminder)))};
    }
  }
  const linkedReminder=schedule?.dueAt&&note.aiIntent?.linkedReminder?{...note.aiIntent.linkedReminder,date:schedule.dueAt.slice(0,10),time:schedule.dueAt.slice(11,16)}:note.aiIntent?.linkedReminder;
  return{...note,scheduledDate:nextDate,scheduledTime:nextTime,aiIntent:{...note.aiIntent,date:nextDate,time:nextTime,...(linkedReminder?{linkedReminder}:{})},...(schedule?{schedule}:{})};
}

function wallClockMs(value){
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match?Date.UTC(...match.slice(1).map(Number).map((part,index)=>index===1?part-1:part)):NaN;
}

function wallClockDateTime(value){
  return`${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,"0")}-${String(value.getUTCDate()).padStart(2,"0")}T${String(value.getUTCHours()).padStart(2,"0")}:${String(value.getUTCMinutes()).padStart(2,"0")}:00`;
}

function eventWhen(date,time){
  if(!date||!time)return"Fecha u hora sin definir";
  const value=new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime())?`${date} · ${time}`:value.toLocaleString("es-ES",{dateStyle:"full",timeStyle:"short"});
}

function usableName(value){
  const name=String(value||"").trim();
  return name&&!/^(?:un\s+|el\s+)?contacto$|^persona$/i.test(name)?name:null;
}

function callName(text){
  const match=String(text||"").match(/\b(?:llamar|llama|telefonear|telefonea|contactar|contacta)\s+(?:a\s+|al\s+)?(.+)/i);
  if(!match)return null;
  const name=match[1].split(/\s+(?:pasado\s+mañana|mañana|hoy|a\s+las?\b|el\s+(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo|\d)|por\s+la\s+(?:mañana|tarde|noche)\b)|[.!?;,]/i)[0].trim();
  if(/^(?:mañana|hoy|pasado\s+mañana|a\s+las?\b)/i.test(name))return null;
  return usableName(name);
}

export function scheduleWhen(schedule){
  if(!schedule?.dueAt)return"fecha sin definir";
  const date=new Date(schedule.dueAt);
  return Number.isNaN(date.getTime())?schedule.dueAt:date.toLocaleString("es-ES",{dateStyle:"full",timeStyle:"short"});
}

export function scheduleState(schedule){
  return({pending_confirmation:"Pendiente de confirmar",scheduled:"Programado",due:"Pendiente de completar",completed:"Completado",cancelled:"Cancelado",error:"Error al programar"})[schedule?.status]||"Pendiente";
}

function dateKey(date){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
