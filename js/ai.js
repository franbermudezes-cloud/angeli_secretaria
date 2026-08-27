import{calendarQueryRange,cleanTemporalText,temporalData}from"./temporal.js?v=0.21.26";

export const VALID_INTENTS=["note","task.create","task.complete","reminder.create","reminder.query","calendar.create","calendar.query","calendar.update","calendar.delete","contact.call","file.store","photo.store"];
const SENSITIVE_INTENTS=new Set(["calendar.update","calendar.delete","contact.call"]);
const MAX_TEXT_LENGTH=500,MIN_CONFIDENCE=0.75;
const INTERPRETER_URL="https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app/interpret";
const EMPTY={title:null,date:null,time:null,rangeStart:null,rangeEnd:null,location:null,contactName:null,phone:null,notes:null,target:null,changes:null,linkedReminder:null,missingFields:[],question:null};

// Una orden explícita prepara una búsqueda, nunca ejecuta el borrado.
export function localCalendarCancellation(text = "") {
  const prefix = /^\s*(?:cancela(?:r)?|borra(?:r)?|anula(?:r)?)\s+(?:la\s+|el\s+)?/i;
  if (!prefix.test(text)) return null;
  let title = targetTitle(text, prefix);
  if (!title || !/\b(?:llamada|llamar|recordatorio|aviso|evento|cita|quedada|cena|comida|reuni[oó]n)\b/i.test(title)) return null;
  // Calendar busca texto, no sinónimos: «llamada a» no coincide con «Llamar a».
  title = title.replace(/^(?:recordatorio\s+(?:de|para)\s+)?(?:llamada|llamar)\s+(?:a|de|con)\s+/i, "");
  const temporal = temporalData(text);
  return { ...EMPTY, intent: "calendar.delete", confidence: .5,
    target: { title, date: temporal.scheduledDate || null, time: temporal.scheduledTime || null },
    requiresConfirmation: true };
}

// Respaldo seguro para reprogramar: identifica el evento y separa los datos
// nuevos. También completa una modificación activa cuando la respuesta es tan
// breve como «a las once» y la IA remota no está disponible.
export function localCalendarUpdate(text = "", now = new Date(), active = null) {
  const value = String(text || "").trim();
  const verb = /\b(?:pasa(?:me)?|c[aá]mbia(?:me)?|mueve(?:me)?|modifica(?:me)?|retrasa(?:me)?|adelanta(?:me)?|reprograma(?:me)?|pasar|cambiar|mover|modificar|retrasar|adelantar|reprogramar)\b/i;
  const continuing = active?.interaction?.status === "awaiting_input" && active.aiIntent?.intent === "calendar.update";
  if (!verb.test(value) && !continuing) return null;
  const temporal = temporalData(value, now);
  const changes = {
    ...(temporal.scheduledDate ? { date: temporal.scheduledDate } : {}),
    ...(temporal.scheduledTime ? { time: temporal.scheduledTime } : {})
  };
  const match = verb.exec(value);
  let target = active?.aiIntent?.target?.title || "";
  if (match) {
    const before = value.slice(0, match.index).replace(/\bahora\b/gi, "").trim();
    let candidate = /\b(?:llamada|recordatorio|aviso|evento|cita|cena|comida|reuni[oó]n)\b/i.test(before)
      ? before
      : value.slice(match.index + match[0].length);
    candidate = candidate
      .replace(/^\s*(?:(?:(?:la\s+|el\s+)?(?:hora|fecha|d[ií]a|ubicaci[oó]n|lugar|t[ií]tulo)|de\s+(?:hora|fecha|d[ií]a|ubicaci[oó]n|lugar|t[ií]tulo))\s+(?:de|del|para|con)\s+)?(?:la\s+|el\s+)?/i, "")
      .replace(/\b(?:para|hasta|al?)\s+(?=(?:el\s+)?(?:hoy|mañana|pasado\s+mañana|domingo|lunes|martes|miércoles|jueves|viernes|sábado|\d))/i, " ")
      .replace(/\bahora\b/gi, " ");
    candidate = cleanTemporalText(candidate)
      .replace(/^(?:la\s+|el\s+)?(?:(?:recordatorio|aviso)\s+(?:de|para)|(?:llamada|llamar)\s+(?:a|de|con))\s+/i, "")
      .replace(/\s{2,}/g, " ").trim();
    if (candidate) target = candidate;
  }
  return { ...EMPTY, intent: "calendar.update", confidence: .5,
    target: target ? { title: target, date: null, time: null } : null,
    changes: Object.keys(changes).length ? changes : null,
    requiresConfirmation: true };
}

// Respaldo de lectura: la IA sigue siendo la primera opción en producción.
export function localReminderQuery(text = "") {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!/\b(?:que|cuales|dime|muestrame|consulta)\b.*\brecordatorios?\b/i.test(normalized)) return null;
  const match = text.match(/\brecordatorios?\b(?:\s+(?:tengo|tenía|tenia|hay))?\s+(?:de|sobre)\s+(.+?)(?:[.!?,;]|$)/i);
  return { ...EMPTY, intent: "reminder.query", confidence: .5,
    target: match ? { title: match[1].trim(), date: null, time: null } : null,
    requiresConfirmation: false };
}

export async function interpret(text,{provider=mockProvider,fallback,context=null}={}){try{const intent=validateIntent(await provider(text,context));if(intent.confidence<MIN_CONFIDENCE)throw new Error("Baja confianza");return{...intent,source:"ai",fallbackReason:null}}catch(error){const local=typeof fallback==="function"?fallback(text,context):fallback;return{...validateIntent(local),source:"fallback",fallbackReason:failureReason(error)}}}

// La detección local protege la clase de una acción sensible, pero no debe
// borrar la comprensión semántica de Gemini. Si la IA reconoció la misma
// operación, conserva su objetivo (por ejemplo, solo "Miguel") y usa lo local
// únicamente para fechas/cambios explícitos y confirmación obligatoria.
export function protectCalendarInterpretation(remote, local) {
  if (!local) return remote;
  const sameIntent = remote?.intent === local.intent;
  if (!sameIntent) return { ...remote, ...local, source: remote?.source, fallbackReason: remote?.fallbackReason };
  const remoteTitle = semanticCalendarTarget(remote?.target?.title);
  const remoteTarget = remoteTitle ? { ...remote.target, title: remoteTitle } : null;
  const target = remoteTarget
    ? { ...remoteTarget,
        ...(local.target?.date ? { date: local.target.date } : {}),
        ...(local.target?.time ? { time: local.target.time } : {}) }
    : local.target;
  return {
    ...remote,
    intent: local.intent,
    target,
    changes: local.changes || remote.changes || null,
    requiresConfirmation: true,
    missingFields: [],
    question: null
  };
}

// Separa el campo que se quiere cambiar del identificador del evento. Expresiones
// como «hora con María» o «fecha de la reunión con Carlos» describen el cambio;
// Calendar debe buscar a María o la reunión con Carlos, nunca la palabra «hora».
export function semanticCalendarTarget(value = "") {
  return String(value || "")
    .replace(/^\s*(?:la\s+|el\s+)?(?:hora|fecha|d[ií]a|ubicaci[oó]n|lugar|t[ií]tulo)\s+(?:de|del|para|con)\s+/i, "")
    .replace(/^\s*de\s+(?:hora|fecha|d[ií]a|ubicaci[oó]n|lugar|t[ií]tulo)\s+(?:de|del|para|con)\s+/i, "")
    .trim();
}

export async function remoteProvider(text,idToken,context=null){if(!idToken)throw new Error("IA sin conexión");const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(INTERPRETER_URL,{method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify({text,now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Europe/Madrid",context}),signal:controller.signal});if(!response.ok)throw new Error(`IA no disponible (${response.status})`);return await response.json()}finally{clearTimeout(timeout)}}

export async function mockProvider(text){const value=(text||"").trim(),lower=value.toLowerCase(),temporal=temporalData(value),reminderTemporal=temporalData(value,new Date(),{inferDateFromTime:true}),base={...EMPTY,confidence:.9,requiresConfirmation:false};const linked=localLinkedCalendarIntent(value);if(linked)return linked;if(/\b(?:ya\s+)?he\s+(?:llamado|terminado|completado|hecho)\b/.test(lower))return{...base,intent:"task.complete",confidence:.92,target:{title:completionTitle(value),date:null,time:null}};if(/\b(?:cancela|cancelar|borra|borrar|anula|anular)\b/.test(lower))return{...base,intent:"calendar.delete",confidence:.94,target:{title:targetTitle(value,/^(?:cancela(?:r)?|borra(?:r)?|anula(?:r)?)\s+(?:la\s+|el\s+)?/i),date:temporal.scheduledDate||null,time:temporal.scheduledTime||null},requiresConfirmation:true};const update=localCalendarUpdate(value);if(update)return{...update,confidence:.91};if(/\b(?:qué|que)\s+(?:tengo|hay)|\b(?:muéstrame|muestrame|consulta)\s+(?:mi\s+)?(?:agenda|calendario)\b/.test(lower))return{...base,intent:"calendar.query",confidence:.91,...(calendarQueryRange(value)||{}),requiresConfirmation:false};if(/\b(?:recuérdame|recordar)\b/.test(lower))return{...base,intent:"reminder.create",confidence:.92,title:value,date:reminderTemporal.scheduledDate||null,time:reminderTemporal.scheduledTime||null,contactName:contactName(value),requiresConfirmation:Boolean(reminderTemporal.scheduledDate&&reminderTemporal.scheduledTime)};if(/\b(?:hacer|comprar|preparar|enviar|revisar)\b/.test(lower))return{...base,intent:"task.create",confidence:.9,title:value,date:temporal.scheduledDate||null,time:temporal.scheduledTime||null,requiresConfirmation:false};if(/\b(?:llama|llamar|telefonea|telefonear|contacta|contactar)\b/.test(lower)){const contactNameValue=contactName(value);if(temporal.scheduledDate&&temporal.scheduledTime)return{...base,intent:"reminder.create",confidence:.94,title:`Llamar a ${contactNameValue||"contacto"}`,date:temporal.scheduledDate,time:temporal.scheduledTime,contactName:contactNameValue,phone:null,requiresConfirmation:true};return{...base,intent:"contact.call",confidence:.92,contactName:contactNameValue,phone:null,requiresConfirmation:true}}if(temporal.scheduledDate&&temporal.scheduledTime)return{...base,intent:"calendar.create",confidence:.93,title:calendarTitle(value),date:temporal.scheduledDate,time:temporal.scheduledTime,location:location(value),requiresConfirmation:true};return{...base,intent:"note",confidence:.8,title:value,requiresConfirmation:false}}

// P05: una única orden puede contener un evento principal y un aviso relativo.
// El respaldo local cubre la formulación literal del caso oficial sin inventar
// datos: el aviso hereda la hora del evento y desplaza únicamente su fecha.
export function localLinkedCalendarIntent(text="",now=new Date()){
  const parts=String(text||"").split(/\b(?:recuérdame|recuerdame)\b/i);
  if(parts.length!==2||!/\b(?:d[ií]as?|día)\s+antes\b/i.test(parts[1]))return null;
  const eventText=parts[0].trim(),eventTemporal=temporalData(eventText,now);
  if(!eventTemporal.scheduledDate||!eventTemporal.scheduledTime)return null;
  const explicitMorning=/\b(?:de|por)\s+la\s+mañana\b|\ba\.?\s*m\.?\b/i.test(eventText);
  if(!explicitMorning&&/\b(?:boda|cena|fiesta|actuaci[oó]n)\b/i.test(eventText)&&Number(eventTemporal.scheduledTime.slice(0,2))<9){
    eventTemporal.scheduledTime=`${String(Number(eventTemporal.scheduledTime.slice(0,2))+12).padStart(2,"0")}:${eventTemporal.scheduledTime.slice(3)}`;
  }
  const offsetMatch=parts[1].match(/\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete)\s+d[ií]as?\s+antes\b/i);
  if(!offsetMatch)return null;
  const words={un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7};
  const offset=Number(offsetMatch[1])||words[offsetMatch[1].toLowerCase()];
  if(!offset||offset>30)return null;
  const date=new Date(`${eventTemporal.scheduledDate}T12:00:00`);date.setDate(date.getDate()-offset);
  const reminderTitle=parts[1].replace(offsetMatch[0],"").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,"").trim();
  if(!reminderTitle)return null;
  const eventTitle=calendarTitle(eventText);
  return{...EMPTY,intent:"calendar.create",confidence:.9,title:eventTitle.charAt(0).toUpperCase()+eventTitle.slice(1),date:eventTemporal.scheduledDate,time:eventTemporal.scheduledTime,location:location(eventText),linkedReminder:{title:reminderTitle.charAt(0).toUpperCase()+reminderTitle.slice(1),date:dateKey(date),time:eventTemporal.scheduledTime},requiresConfirmation:true};
}

export function validateIntent(raw){if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Respuesta IA no válida");const allowed=new Set(["intent","confidence","title","date","time","rangeStart","rangeEnd","location","contactName","phone","notes","target","changes","linkedReminder","requiresConfirmation","missingFields","question"]);if(Object.keys(raw).some(key=>!allowed.has(key)))throw new Error("Campo IA no permitido");if(!VALID_INTENTS.includes(raw.intent))throw new Error("Intent IA no permitido");if(typeof raw.confidence!=="number"||raw.confidence<0||raw.confidence>1)throw new Error("Confianza IA no válida");const normalized={...EMPTY,intent:raw.intent,confidence:raw.confidence,requiresConfirmation:Boolean(raw.requiresConfirmation)};for(const key of["title","location","contactName","phone","notes","question"]){if(raw[key]!==undefined&&raw[key]!==null){if(typeof raw[key]!=="string"||raw[key].length>MAX_TEXT_LENGTH)throw new Error("Texto IA no válido");normalized[key]=raw[key].trim()||null}}for(const key of["date","time","rangeStart","rangeEnd"]){if(raw[key]!==undefined&&raw[key]!==null){if(!isValidTemporal(key,raw[key]))throw new Error("Fecha u hora IA no válida");normalized[key]=raw[key]}}if(normalized.rangeStart&&normalized.rangeEnd&&normalized.rangeStart>=normalized.rangeEnd)throw new Error("Intervalo IA no válido");normalized.target=normalizeTarget(raw.target);normalized.changes=normalizeChanges(raw.changes);normalized.linkedReminder=normalizeLinkedReminder(raw.linkedReminder);normalized.missingFields=normalizeMissingFields(raw.missingFields);if(normalized.missingFields.length&&!normalized.question)normalized.question=null;if(SENSITIVE_INTENTS.has(normalized.intent))normalized.requiresConfirmation=true;return normalized}

function normalizeTarget(target){if(target===undefined||target===null)return null;if(typeof target!=="object"||Array.isArray(target))throw new Error("Objetivo IA no válido");const allowed=new Set(["title","date","time"]);if(Object.keys(target).some(key=>!allowed.has(key)))throw new Error("Objetivo IA no permitido");if(typeof target.title!=="string"||!target.title.trim()||target.title.length>MAX_TEXT_LENGTH)throw new Error("Título objetivo no válido");if(target.date!==null&&target.date!==undefined&&!isValidTemporal("date",target.date))throw new Error("Fecha objetivo no válida");if(target.time!==null&&target.time!==undefined&&!isValidTemporal("time",target.time))throw new Error("Hora objetivo no válida");return{title:target.title.trim(),date:target.date||null,time:target.time||null}}
function normalizeChanges(changes){if(changes===undefined||changes===null)return null;if(typeof changes!=="object"||Array.isArray(changes))throw new Error("Cambios IA no válidos");const allowed=new Set(["title","date","time","location","notes"]);if(Object.keys(changes).some(key=>!allowed.has(key)))throw new Error("Cambio IA no permitido");const result={};for(const key of allowed){if(changes[key]===undefined||changes[key]===null)continue;if(["date","time"].includes(key)){if(!isValidTemporal(key,changes[key]))throw new Error("Cambio temporal no válido");result[key]=changes[key]}else{if(typeof changes[key]!=="string"||changes[key].length>MAX_TEXT_LENGTH)throw new Error("Cambio de texto no válido");result[key]=changes[key].trim()}}return Object.keys(result).length?result:null}
function normalizeLinkedReminder(value){if(value===undefined||value===null)return null;if(typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["title","date","time","notes"].includes(key)))throw new Error("Aviso vinculado no válido");if(typeof value.title!=="string"||!value.title.trim()||value.title.length>MAX_TEXT_LENGTH||!isValidTemporal("date",value.date)||!isValidTemporal("time",value.time))throw new Error("Datos del aviso vinculado no válidos");if(value.notes!==undefined&&value.notes!==null&&(typeof value.notes!=="string"||value.notes.length>MAX_TEXT_LENGTH))throw new Error("Descripción del aviso vinculado no válida");return{title:value.title.trim(),date:value.date,time:value.time,notes:typeof value.notes==="string"?value.notes.trim():null}}
function normalizeMissingFields(fields){if(fields===undefined||fields===null)return[];if(!Array.isArray(fields)||fields.length>7)throw new Error("Campos pendientes no válidos");const allowed=new Set(["title","date","time","location","contactName","phone","target"]);if(fields.some(field=>typeof field!=="string"||!allowed.has(field)))throw new Error("Campo pendiente no válido");return[...new Set(fields)]}
function failureReason(error){const message=String(error?.message||"");if(/Baja confianza/i.test(message))return"low_confidence";if(/abort/i.test(message))return"timeout";if(/\b503\b|IA no disponible/i.test(message))return"service_unavailable";return"invalid_or_unavailable"}
function isValidTemporal(type,value){if(typeof value!=="string")return false;if(type==="time")return/^([01]\d|2[0-3]):[0-5]\d$/.test(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T12:00:00`);return!Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value}
function dateKey(date){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
function targetTitle(text,prefix){return cleanTemporalText((text||"").replace(prefix,"").replace(/\b(?:de|del)\s+(?:mañana|domingo|lunes|martes|miércoles|jueves|viernes|sábado)\b/gi,"").trim())}
function calendarTitle(text){return cleanTemporalText(text).replace(/^\s*(?:me\s+han\s+)?contratad[oa]\s+(?:una?\s+)?/i,"").replace(/^\s*tenemos?\s+(?:una?\s+)?/i,"").replace(/\s+en\s+[\p{L}][\p{L}\s-]{1,60}[.]?$/iu,"").replace(/\b(?:el|la)\s*[.]?$/i,"").trim()||"Evento de Angeli Secretaria"}
function contactName(text){const match=(text||"").match(/\b(?:llama(?:r)?|telefonea(?:r)?|contacta(?:r)?)\s+(?:a\s+|al\s+)?(.+?)(?:[.!?,;]|$)/i);if(!match)return null;const value=cleanTemporalText(match[1]).replace(/\b(?:mañana|hoy|luego|por favor)\b.*$/i,"").trim();return value||null}
function location(text){const match=(text||"").match(/\ben\s+([\p{L}][\p{L}\d\s,.'’-]{1,100})(?:[.!?;]|$)/iu);return match?match[1].trim().replace(/[,.]+$/,""):null}
function completionTitle(text){return(text||"").replace(/^\s*(?:ya\s+)?(?:he\s+)?(?:llamado|terminado|completado|hecho)\s+(?:a\s+)?/i,"").replace(/[.!?,;]+$/g,"").trim()||"Pendiente"}
