import{nextDateForTime,temporalData,explicitRelativeDate}from"./temporal.js?v=0.21.10";

const CALL_INTENT=/\b(?:llama|llamar|telefonea|telefonear|contacta|contactar)\b/i;

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
  const call=CALL_INTENT.test(text||"")||Boolean(interpretation.contactName)||Boolean(interpretation.phone);
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

export function scheduleTitle(note){
  const action=note.schedule?.action||{};
  if(action.kind==="contact.call"){
    const name=usableName(action.contactName)||usableName(note.aiIntent?.contactName)||callName(note.aiIntent?.title)||callName(note.text);
    if(name||action.phone)return`Llamar a ${name||action.phone}`;
    // No desechar la instrucción original si no pudimos separar el nombre.
    return(note.text||note.aiIntent?.title||"Llamar a contacto").trim();
  }
  return(note.aiIntent?.title||note.text||"Recordatorio").trim();
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
