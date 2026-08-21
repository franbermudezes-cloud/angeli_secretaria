import{nextDateForTime,temporalData}from"./temporal.js?v=0.18.4";

const CALL_INTENT=/\b(?:llama|llamar|telefonea|telefonear|contacta|contactar)\b/i;

export function normalizeFutureCall(interpretation,text){
  if(interpretation?.intent!=="contact.call"||!interpretation.date||!interpretation.time)return interpretation;
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
  const date=interpretation.date||local.scheduledDate||(time?dateKey(nextDateForTime(time,now)):null);
  return{...interpretation,date,time,requiresConfirmation:Boolean(date&&time)};
}

export function scheduleFor(interpretation,text){
  if(interpretation?.intent!=="reminder.create"||!interpretation.date||!interpretation.time)return null;
  const call=CALL_INTENT.test(text||"")||Boolean(interpretation.contactName)||Boolean(interpretation.phone);
  return{
    dueAt:`${interpretation.date}T${interpretation.time}:00`,
    timeZone:"Europe/Madrid",
    action:{kind:call?"contact.call":"reminder",contactName:interpretation.contactName||null,phone:interpretation.phone||null},
    status:"pending_confirmation",
    delivery:{calendar:"pending",android:"pending"},
    calendarEventId:null,
    calendarUrl:null,
    externalJobId:null,
    lastError:null
  };
}

export function scheduleTitle(note){
  const action=note.schedule?.action||{};
  if(action.kind==="contact.call")return`Llamar a ${action.contactName||action.phone||"contacto"}`;
  return(note.aiIntent?.title||note.text||"Recordatorio").trim();
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
