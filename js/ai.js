import{calendarQueryRange,cleanTemporalText,naturalQueryRange,temporalData}from"./temporal.js?v=0.22.24";
import{localWhatsApp}from"./whatsapp.js?v=0.22.24";
import{REMINDER_TRIGGER}from"./keywords.js?v=0.22.24";

export const VALID_INTENTS=["note","note.query","task.create","task.complete","reminder.create","reminder.query","calendar.create","calendar.query","calendar.update","calendar.delete","contact.call","whatsapp.compose","file.store","photo.store"];
const SENSITIVE_INTENTS=new Set(["calendar.update","calendar.delete","contact.call","whatsapp.compose"]);
const MAX_TEXT_LENGTH=500,MIN_CONFIDENCE=0.75;
const INTERPRETER_URL="https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app/interpret";
const CHAT_ASIDE_URL="https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app/chat/aside";
const MERCADONA_SEARCH_URL="https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app/shopping/mercadona/search";
const EMPTY={title:null,date:null,time:null,rangeStart:null,rangeEnd:null,location:null,contactName:null,phone:null,notes:null,noteQuery:null,noteStatus:null,noteClassification:null,target:null,changes:null,linkedReminder:null,missingFields:[],question:null};

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
//
// Hallazgo de la auditoría completa del código: a diferencia de
// localCalendarCancellation (arriba), esta función no exigía ninguna
// palabra de calendario — solo un verbo cotidiano (pasa/cambia/mueve/...).
// Frases normales sin relación con Calendar como «Cámbiame el turno del
// trabajo, ponlo de tarde» o «Mueve la caja del salón al trastero»
// coincidían igualmente, y protectCalendarInterpretation sustituía la
// clasificación remota correcta (nota/tarea) por un falso «modificar
// evento» con un título inventado. Se exige ahora que la frase traiga
// alguna señal real de que es sobre un evento: una palabra de calendario,
// uno de los campos que se pueden cambiar (hora/fecha/ubicación/título...),
// o una fecha/hora explícita detectada — «Cámbiame la hora de Miguel» o
// «Pasa lo de Miguel al viernes a las once» siguen reconociéndose (llevan
// "hora" o una fecha/hora reales), pero una frase sin ninguna de esas tres
// señales ya no se confunde con modificar un evento.
const CALENDAR_UPDATE_CONTEXT = /\b(?:llamada|recordatorio|aviso|evento|cita|quedada|cena|comida|reuni[oó]n|calendario|hora|fecha|d[ií]a|ubicaci[oó]n|lugar|t[ií]tulo)\b/i;
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
  if (!continuing && !Object.keys(changes).length && !CALENDAR_UPDATE_CONTEXT.test(value)) return null;
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
  // Hallazgo de la auditoría completa del código: «Recuérdame que revise los
  // recordatorios del banco el viernes» es una orden normal para CREAR un
  // recordatorio nuevo — pero "que" es de las palabras más comunes del
  // español, y el contenido del propio recordatorio menciona
  // "recordatorios". Sin este guard, explicitQuery coincidía igual y
  // protectReadQuery sustituía la creación por una consulta vacía. Mismo
  // criterio ya usado en localImmediateCall para el mismo problema.
  if (REMINDER_TRIGGER.test(text)) return null;
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const explicitQuery=/\b(?:que|cuales|dime|muestrame|ensename|ver|listar|lista|busca|buscar|consulta|consultar)\b.*\brecordatorios?\b/i.test(normalized);
  const bareQuery=/^(?:mis\s+|los\s+)?recordatorios?(?:\s+pendientes?)?[.!?]*$/i.test(normalized.trim());
  if (!explicitQuery && !bareQuery) return null;
  const match = text.match(/\brecordatorios?\b(?:\s+(?:tengo|tenía|tenia|hay))?\s+(?:de|sobre)\s+(.+?)(?:[.!?,;]|$)/i);
  const range=naturalQueryRange(text),title=match&&!range?match[1].trim():null;
  return { ...EMPTY, intent: "reminder.query", confidence: .5, ...(range||{}),
    target: title ? { title, date: null, time: null } : null,
    requiresConfirmation: false };
}

export function localNoteQuery(text = "") {
  const value=String(text||"").trim(),normalized=value.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  if(/^\s*(?:anota|apunta|guarda|guardar|crea|crear|haz)\b/i.test(normalized))return null;
  // Hallazgo de la auditoría completa del código: «Recuérdame que revise mis
  // notas del banco el viernes» es una orden para CREAR un recordatorio, no
  // una consulta de notas — pero contiene "que" y "notas", suficiente para
  // que explicitQuery coincidiera igual y perdiera la orden entera. Mismo
  // criterio ya usado en localImmediateCall/localReminderQuery.
  if(REMINDER_TRIGGER.test(normalized))return null;
  const explicitQuery=/\b(?:que|cuales|dime|muestrame|busca|consulta|ensename|ver|listar)\b.*\bnotas?\b/i.test(normalized);
  const listCommand=/^\s*lista(?:me)?\b.*\bnotas?\b/i.test(normalized);
  if(!explicitQuery&&!listCommand)return null;
  const match=value.match(/\bnotas?\b(?:\s+(?:que\s+)?(?:tengo|hay))?\s+(?:del?|sobre|relacionadas?\s+con)\s+(.+?)(?:[.!?,;]|$)/i);
  const scope=/\bpersonales?\b/i.test(value)?"personal":/\b(?:empresa|trabajo|profesionales?)\b/i.test(value)?"company":"general";
  const noteStatus=/\b(?:hechas?|completadas?|terminadas?|archivadas?)\b/i.test(value)?"done":/\btodas?\b/i.test(value)?"all":"pending";
  const range=naturalQueryRange(value);
  return{...EMPTY,intent:"note.query",confidence:.5,...(range||{}),noteQuery:match&&!range?match[1].trim():null,noteStatus,
    noteClassification:{scope,relationType:"none",relationName:null,purpose:null,tags:[]},requiresConfirmation:false};
}

// Las órdenes inequívocas de lectura mandan sobre una clasificación remota
// errónea. Esto evita que «Recordatorios» o «Ver las notas hechas» creen una
// nota aunque el proveedor responda con confianza alta.
export function protectReadQuery(remote,noteQuery=null,reminderQuery=null){
  const local=noteQuery||reminderQuery;
  return local?{...local,source:remote?.source,fallbackReason:remote?.fallbackReason}:remote;
}

export async function interpret(text,{provider=mockProvider,fallback,context=null}={}){try{const intent=validateIntent(await provider(text,context));if(intent.confidence<MIN_CONFIDENCE)throw new Error("Baja confianza");return{...intent,source:"ai",fallbackReason:null}}catch(error){const local=typeof fallback==="function"?fallback(text,context):fallback;return{...validateIntent(local),source:"fallback",fallbackReason:failureReason(error)}}}

// Reportado en real: «quiero llamar a Ana» se guardó como nota en vez de
// iniciar la llamada. «Llama/llamar a X» sin fecha ni hora es inequívoco: es
// una llamada ahora, nunca una nota ni una tarea. Exige «a»/«al» justo
// después del verbo para no confundirse con «el proyecto se llama X»
// (llamarse, no llamar a alguien), que no lleva esa preposición ahí.
const IMMEDIATE_CALL_PATTERN=/\b(?:llama|llamar|llámame|telefonea|telefonear|contacta|contactar)\s+(?:a|al)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'.-]*(?:\s+[A-Za-zÀ-ÿ][\wÀ-ÿ'.-]*){0,3})/i;
export function localImmediateCall(text="",now=new Date()){
  const value=String(text||"").trim();
  // «Recuérdame llamar a X» pide un recordatorio, no una llamada ahora
  // mismo, aunque no lleve fecha ni hora explícitas: classify() ya prioriza
  // ese verbo sobre «llamar» y esta protección debe respetar el mismo orden.
  if(REMINDER_TRIGGER.test(value))return null;
  const match=IMMEDIATE_CALL_PATTERN.exec(value);
  if(!match)return null;
  const temporal=temporalData(value,now);
  if(temporal.scheduledDate||temporal.scheduledTime)return null;
  const name=match[1].replace(/\b(?:mañana|hoy|luego|ahora|por favor|ya)\b.*$/i,"").trim();
  if(!name)return null;
  return{...EMPTY,intent:"contact.call",confidence:1,contactName:name,requiresConfirmation:true};
}

// Hallazgo de la auditoría completa del código, generalizando el carve-out ya
// aplicado a la lista de la compra (ver app.js, add()): una pregunta pendiente
// de OTRA orden (p. ej. un WhatsApp a medias esperando el nombre del contacto
// o el texto del mensaje) se comía cualquier frase nueva como si fuera la
// respuesta a esa pregunta — incluido un "Recuérdame llamar al médico
// mañana" que no tiene nada que ver. El problema no es solo que la IA remota
// reciba el contexto de `active` y pueda malinterpretar continuidad: algunos
// respaldos locales (localWhatsApp con missingFields contactName/notes) daban
// por buena CUALQUIER texto como respuesta, sin comprobar si en realidad era
// una orden nueva de otro dominio. Esta función detecta, de forma
// determinista y ANTES de tocar el intérprete, si el texto trae un disparador
// inequívoco de orden nueva ("Recuérdame...", "envía/manda un whatsapp a...",
// "nuevo evento"/"añade... al calendario", "llama a..."), reutilizando los
// mismos parsers locales ya usados para detectar esas órdenes desde cero
// (localWhatsApp sin `active` y localImmediateCall, que nunca han necesitado
// contexto de conversación porque ya son disparadores explícitos). Solo se
// usa para decidir si `active` debe descartarse ese turno — nunca para
// generar la interpretación final, que sigue haciéndose con el pipeline
// normal una vez `active` es null.
const EXPLICIT_CALENDAR_CREATE_TRIGGER = /\bnuevo\s+evento\b|\ba[ñn]ade(?:lo)?\s+(?:esto\s+)?al\s+calendario\b/i;
export function explicitNewCommandDomain(text = "", now = new Date()) {
  const value = String(text || "").trim();
  if (!value) return null;
  if (REMINDER_TRIGGER.test(value)) return "reminder";
  if (EXPLICIT_CALENDAR_CREATE_TRIGGER.test(value)) return "calendar";
  // Se llama con `active=null` a propósito: aquí solo interesa si el texto
  // por sí solo dispara una orden nueva de WhatsApp, no si continúa una
  // interacción — esa distinción la hace `activeIntentDomain` comparando
  // dominios, no localWhatsApp.
  if (localWhatsApp(value, null)) return "whatsapp";
  if (localImmediateCall(value, now)) return "call";
  return null;
}
export function activeIntentDomain(active) {
  const intent = active?.aiIntent?.intent;
  if (intent === "reminder.create") return "reminder";
  if (intent === "whatsapp.compose") return "whatsapp";
  if (intent === "calendar.create" || intent === "calendar.update" || intent === "calendar.delete") return "calendar";
  if (intent === "contact.call") return "call";
  return null;
}

// Si la IA ya identificó una llamada (puede traer teléfono, apellidos...) se
// conserva tal cual. Solo corrige el caso reportado: una orden de llamada
// clara que la IA clasificó como nota o tarea.
export function protectContactCallInterpretation(remote,local){
  if(!local||remote?.intent==="contact.call")return remote;
  if(remote?.intent!=="note"&&remote?.intent!=="task.create")return remote;
  return{...remote,...local,source:remote?.source,fallbackReason:remote?.fallbackReason};
}

// La detección local protege la clase de una acción sensible, pero no debe
// borrar la comprensión semántica de Gemini. Si la IA reconoció la misma
// operación, conserva su objetivo (por ejemplo, solo "Miguel") y usa lo local
// únicamente para fechas/cambios explícitos y confirmación obligatoria.
export function protectCalendarInterpretation(remote, local) {
  if (!local) return remote;
  const sameIntent = remote?.intent === local.intent;
  if (!sameIntent) return { ...remote, ...local, source: remote?.source, fallbackReason: remote?.fallbackReason };
  // Una orden compuesta ya ha sido separada de forma determinista en evento,
  // recinto y aviso relativo. Gemini puede enriquecer su descripción, pero no
  // debe volver a meter el recinto en el título ni borrar la ubicación.
  if(local.intent==="calendar.create"&&local.linkedReminder)return{
    ...remote,
    title:local.title,date:local.date,time:local.time,location:local.location,
    linkedReminder:local.linkedReminder,requiresConfirmation:true,
    missingFields:[],question:null
  };
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
    // Real encontrado en auditoría: localCalendarUpdate solo detecta fecha/
    // hora explícitas, nunca ubicación/título/descripción — pero con "||" en
    // vez de fusionar, en cuanto local.changes traía algo (una fecha u hora
    // detectada), se descartaba entero remote.changes, perdiendo en
    // silencio cualquier otro cambio (p. ej. ubicación) que la IA sí hubiera
    // entendido bien en la misma orden («...a las nueve y ponla en el
    // restaurante Cala Blava» perdía el restaurante).
    changes: (local.changes || remote.changes) ? { ...(remote.changes || {}), ...(local.changes || {}) } : null,
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

// Módulo aparte, deliberadamente desacoplado del intérprete de órdenes: solo
// pide una frase corta de reacción para el modo conversación, nunca decide
// ni ejecuta ninguna acción. Un fallo aquí (red, timeout, respuesta rara)
// nunca debe romper nada; el llamador decide el respaldo.
export async function chatAside(text,idToken){
 if(!idToken)throw new Error("IA sin conexión");
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2000);
 try{
  const response=await fetch(CHAT_ASIDE_URL,{method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify({text}),signal:controller.signal});
  if(!response.ok)throw new Error(`Aside no disponible (${response.status})`);
  const data=await response.json();
  if(typeof data.reply!=="string"||!data.reply.trim())throw new Error("Respuesta de aside vacía");
  return data.reply.trim();
 }finally{clearTimeout(timeout)}
}

// Catálogo público de Mercadona (sin API oficial de terceros), consultado a
// través del backend para no exponer aquí el recorrido de categorías. Un
// fallo (red, timeout, catálogo caído) nunca debe romper añadir el artículo
// a mano: el llamador simplemente lo guarda sin producto vinculado.
export async function searchMercadonaProduct(query,idToken,limit=6){
 if(!idToken)throw new Error("IA sin conexión");
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
 try{
  const response=await fetch(MERCADONA_SEARCH_URL,{method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify({query,limit}),signal:controller.signal});
  if(!response.ok)throw new Error(`Mercadona no disponible (${response.status})`);
  const data=await response.json();
  return Array.isArray(data.results)?data.results:[];
 }finally{clearTimeout(timeout)}
}

export async function remoteProvider(text,idToken,context=null){if(!idToken)throw new Error("IA sin conexión");const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(INTERPRETER_URL,{method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify({text,now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Europe/Madrid",context}),signal:controller.signal});if(!response.ok)throw new Error(`IA no disponible (${response.status})`);return await response.json()}finally{clearTimeout(timeout)}}

export async function mockProvider(text){
  const value=(text||"").trim(),lower=value.toLowerCase(),temporal=temporalData(value),reminderTemporal=temporalData(value,new Date(),{inferDateFromTime:true}),base={...EMPTY,confidence:.9,requiresConfirmation:false};
  const linked=localLinkedCalendarIntent(value);if(linked)return linked;
  const noteQuery=localNoteQuery(value);if(noteQuery)return{...noteQuery,confidence:.9};
  if(/\b(?:ya\s+)?he\s+(?:llamado|terminado|completado|hecho)\b/.test(lower))return{...base,intent:"task.complete",confidence:.92,target:{title:completionTitle(value),date:null,time:null}};
  if(/\b(?:cancela|cancelar|borra|borrar|anula|anular)\b/.test(lower))return{...base,intent:"calendar.delete",confidence:.94,target:{title:targetTitle(value,/^(?:cancela(?:r)?|borra(?:r)?|anula(?:r)?)\s+(?:la\s+|el\s+)?/i),date:temporal.scheduledDate||null,time:temporal.scheduledTime||null},requiresConfirmation:true};
  const update=localCalendarUpdate(value);if(update)return{...update,confidence:.91};
  if(/\b(?:qué|que)\s+(?:tengo|hay)|\b(?:muéstrame|muestrame|consulta)\s+(?:mi\s+)?(?:agenda|calendario)\b/.test(lower))return{...base,intent:"calendar.query",confidence:.91,...(calendarQueryRange(value)||{}),requiresConfirmation:false};
  if(/\b(?:recuérdame|recordar)\b/.test(lower))return{...base,intent:"reminder.create",confidence:.92,title:value,date:reminderTemporal.scheduledDate||null,time:reminderTemporal.scheduledTime||null,contactName:contactName(value),requiresConfirmation:Boolean(reminderTemporal.scheduledDate&&reminderTemporal.scheduledTime)};
  if(/\b(?:hacer|comprar|preparar|enviar|revisar)\b/.test(lower))return{...base,intent:"task.create",confidence:.9,title:value,date:temporal.scheduledDate||null,time:temporal.scheduledTime||null,requiresConfirmation:false};
  if(/\b(?:llama|llamar|telefonea|telefonear|contacta|contactar)\b/.test(lower)){const contactNameValue=contactName(value);if(temporal.scheduledDate&&temporal.scheduledTime)return{...base,intent:"reminder.create",confidence:.94,title:`Llamar a ${contactNameValue||"contacto"}`,date:temporal.scheduledDate,time:temporal.scheduledTime,contactName:contactNameValue,phone:null,requiresConfirmation:true};return{...base,intent:"contact.call",confidence:.92,contactName:contactNameValue,phone:null,requiresConfirmation:true}}
  if(temporal.scheduledDate&&temporal.scheduledTime)return{...base,intent:"calendar.create",confidence:.93,title:calendarTitle(value),date:temporal.scheduledDate,time:temporal.scheduledTime,location:location(value),requiresConfirmation:true};
  return{...base,intent:"note",confidence:.8,title:noteFallbackTitle(value),noteClassification:{scope:"general",relationType:"none",relationName:null,purpose:null,tags:[]},requiresConfirmation:false};
}

// P05: una única orden puede contener un evento principal y un aviso relativo.
// El respaldo local cubre la formulación literal del caso oficial sin inventar
// datos: el aviso hereda la hora del evento y desplaza únicamente su fecha.
export function localLinkedCalendarIntent(text="",now=new Date()){
  const parts=String(text||"").split(/\b(?:recuérdame|recuerdame|av[ií]same|(?:tienes?\s+que\s+)?avisarme)\b/i);
  if(parts.length!==2||!/\b(?:d[ií]as?|día)\s+antes\b/i.test(parts[1]))return null;
  const eventText=parts[0].trim(),eventTemporal=temporalData(eventText,now);
  if(!eventTemporal.scheduledDate)return null;
  const explicitMorning=/\b(?:de|por)\s+la\s+mañana\b|\ba\.?\s*m\.?\b/i.test(eventText);
  if(eventTemporal.scheduledTime&&!explicitMorning&&/\b(?:boda|cena|fiesta|actuaci[oó]n)\b/i.test(eventText)&&Number(eventTemporal.scheduledTime.slice(0,2))<9){
    eventTemporal.scheduledTime=`${String(Number(eventTemporal.scheduledTime.slice(0,2))+12).padStart(2,"0")}:${eventTemporal.scheduledTime.slice(3)}`;
  }
  const offsetMatch=parts[1].match(/\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete)\s+d[ií]as?\s+antes\b/i);
  if(!offsetMatch)return null;
  const words={un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7};
  const offset=Number(offsetMatch[1])||words[offsetMatch[1].toLowerCase()];
  if(!offset||offset>30)return null;
  const date=new Date(`${eventTemporal.scheduledDate}T12:00:00`);date.setDate(date.getDate()-offset);
  const reminderTitle=parts[1].replace(offsetMatch[0],"").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,"").replace(/^para\s+/i,"").trim();
  if(!reminderTitle)return null;
  const eventTitle=calendarTitle(eventText),eventLocation=location(eventText);
  const cleanEventTitle=eventTitle.charAt(0).toUpperCase()+eventTitle.slice(1);
  const eventName=cleanEventTitle.toLowerCase();
  const eventContext=/^(?:boda|cena|reuni[oó]n|comida|cita|fiesta|actuaci[oó]n)\b/i.test(eventName)?`de la ${eventName}`:`del ${eventName}`;
  const context=[eventContext,eventLocation?`en ${eventLocation}`:null].filter(Boolean).join(" ");
  return{...EMPTY,intent:"calendar.create",confidence:.9,title:cleanEventTitle,date:eventTemporal.scheduledDate,time:eventTemporal.scheduledTime||null,location:eventLocation,linkedReminder:{title:`${reminderTitle.charAt(0).toUpperCase()+reminderTitle.slice(1)} ${context}`,date:dateKey(date),time:eventTemporal.scheduledTime||null},requiresConfirmation:true,missingFields:eventTemporal.scheduledTime?[]:["time"],question:eventTemporal.scheduledTime?null:"¿A qué hora es el evento?"};
}

export function validateIntent(raw){if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Respuesta IA no válida");const allowed=new Set(["intent","confidence","title","date","time","rangeStart","rangeEnd","location","contactName","phone","notes","noteQuery","noteStatus","noteClassification","target","changes","linkedReminder","requiresConfirmation","missingFields","question"]);if(Object.keys(raw).some(key=>!allowed.has(key)))throw new Error("Campo IA no permitido");if(!VALID_INTENTS.includes(raw.intent))throw new Error("Intent IA no permitido");if(typeof raw.confidence!=="number"||raw.confidence<0||raw.confidence>1)throw new Error("Confianza IA no válida");const normalized={...EMPTY,intent:raw.intent,confidence:raw.confidence,requiresConfirmation:Boolean(raw.requiresConfirmation)};for(const key of["title","location","contactName","phone","notes","noteQuery","question"]){if(raw[key]!==undefined&&raw[key]!==null){if(typeof raw[key]!=="string"||raw[key].length>MAX_TEXT_LENGTH)throw new Error("Texto IA no válido");normalized[key]=raw[key].trim()||null}}if(raw.noteStatus!==undefined&&raw.noteStatus!==null){if(!["pending","done","all"].includes(raw.noteStatus))throw new Error("Estado de nota IA no válido");normalized.noteStatus=raw.noteStatus}for(const key of["date","time","rangeStart","rangeEnd"]){if(raw[key]!==undefined&&raw[key]!==null){if(!isValidTemporal(key,raw[key]))throw new Error("Fecha u hora IA no válida");normalized[key]=raw[key]}}if(normalized.rangeStart&&normalized.rangeEnd&&normalized.rangeStart>=normalized.rangeEnd)throw new Error("Intervalo IA no válido");normalized.target=normalizeTarget(raw.target);normalized.changes=normalizeChanges(raw.changes);normalized.linkedReminder=normalizeLinkedReminder(raw.linkedReminder);normalized.noteClassification=normalizeNoteClassification(raw.noteClassification);normalized.missingFields=normalizeMissingFields(raw.missingFields);normalized.question=normalized.missingFields.length?spanishQuestion(normalized.missingFields,normalized.intent):null;if(SENSITIVE_INTENTS.has(normalized.intent))normalized.requiresConfirmation=true;return normalized}

function spanishQuestion(fields,intent){
  const field=fields[0];
  if(field==="title")return intent==="reminder.create"?"¿Qué quieres que te recuerde?":"¿Qué título quieres poner al evento?";
  if(field==="date")return"¿Para qué día es?";
  if(field==="time")return"¿A qué hora?";
  if(field==="location")return"¿Dónde es?";
  if(field==="contactName")return"¿Con quién quieres contactar?";
  if(field==="phone")return"¿Qué número de teléfono quieres usar?";
  if(field==="notes")return intent==="whatsapp.compose"?"¿Qué mensaje quieres escribir?":"¿Qué descripción quieres añadir?";
  if(field==="target")return intent==="calendar.update"?"¿Qué evento quieres modificar?":"¿Qué evento quieres cancelar?";
  return"¿Qué dato falta?";
}

function normalizeTarget(target){if(target===undefined||target===null)return null;if(typeof target!=="object"||Array.isArray(target))throw new Error("Objetivo IA no válido");const allowed=new Set(["title","date","time"]);if(Object.keys(target).some(key=>!allowed.has(key)))throw new Error("Objetivo IA no permitido");if(typeof target.title!=="string"||!target.title.trim()||target.title.length>MAX_TEXT_LENGTH)throw new Error("Título objetivo no válido");if(target.date!==null&&target.date!==undefined&&!isValidTemporal("date",target.date))throw new Error("Fecha objetivo no válida");if(target.time!==null&&target.time!==undefined&&!isValidTemporal("time",target.time))throw new Error("Hora objetivo no válida");return{title:target.title.trim(),date:target.date||null,time:target.time||null}}
function normalizeChanges(changes){if(changes===undefined||changes===null)return null;if(typeof changes!=="object"||Array.isArray(changes))throw new Error("Cambios IA no válidos");const allowed=new Set(["title","date","time","location","notes"]);if(Object.keys(changes).some(key=>!allowed.has(key)))throw new Error("Cambio IA no permitido");const result={};for(const key of allowed){if(changes[key]===undefined||changes[key]===null)continue;if(["date","time"].includes(key)){if(!isValidTemporal(key,changes[key]))throw new Error("Cambio temporal no válido");result[key]=changes[key]}else{if(typeof changes[key]!=="string"||changes[key].length>MAX_TEXT_LENGTH)throw new Error("Cambio de texto no válido");result[key]=changes[key].trim()}}return Object.keys(result).length?result:null}
function normalizeLinkedReminder(value){if(value===undefined||value===null)return null;if(typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["title","date","time","notes"].includes(key)))throw new Error("Aviso vinculado no válido");if(typeof value.title!=="string"||!value.title.trim()||value.title.length>MAX_TEXT_LENGTH||!isValidTemporal("date",value.date)||(value.time!==null&&value.time!==undefined&&!isValidTemporal("time",value.time)))throw new Error("Datos del aviso vinculado no válidos");if(value.notes!==undefined&&value.notes!==null&&(typeof value.notes!=="string"||value.notes.length>MAX_TEXT_LENGTH))throw new Error("Descripción del aviso vinculado no válida");return{title:value.title.trim(),date:value.date,time:value.time||null,notes:typeof value.notes==="string"?value.notes.trim():null}}
function normalizeNoteClassification(value){if(value===undefined||value===null)return null;if(typeof value!=="object"||Array.isArray(value))throw new Error("Clasificación de nota no válida");const allowed=new Set(["scope","categoryLabel","relationType","relationTypeLabel","relationName","purpose","tags"]),safeId=/^[a-z0-9][a-z0-9-]{0,63}$/;if(Object.keys(value).some(key=>!allowed.has(key))||!safeId.test(value.scope)||!safeId.test(value.relationType)||!Array.isArray(value.tags)||value.tags.length>5)throw new Error("Clasificación de nota no válida");const cleanText=key=>{const item=value[key];if(item===undefined||item===null)return null;if(typeof item!=="string"||item.length>MAX_TEXT_LENGTH)throw new Error("Clasificación de nota no válida");return item.trim()||null};const tags=[...new Set(value.tags.map(tag=>{if(typeof tag!=="string"||!tag.trim()||tag.length>60)throw new Error("Etiqueta de nota no válida");return tag.trim()}))];const relationName=value.relationType==="none"?null:cleanText("relationName");return{scope:value.scope,...(cleanText("categoryLabel")?{categoryLabel:cleanText("categoryLabel")}:{ }),relationType:relationName?value.relationType:"none",...(cleanText("relationTypeLabel")?{relationTypeLabel:cleanText("relationTypeLabel")}:{ }),relationName,purpose:cleanText("purpose"),tags}}
function normalizeMissingFields(fields){if(fields===undefined||fields===null)return[];if(!Array.isArray(fields)||fields.length>7)throw new Error("Campos pendientes no válidos");const allowed=new Set(["title","date","time","location","contactName","phone","notes","target"]);if(fields.some(field=>typeof field!=="string"||!allowed.has(field)))throw new Error("Campo pendiente no válido");return[...new Set(fields)]}
function failureReason(error){const message=String(error?.message||"");if(/Baja confianza/i.test(message))return"low_confidence";if(/abort/i.test(message))return"timeout";if(/\b503\b|IA no disponible/i.test(message))return"service_unavailable";return"invalid_or_unavailable"}
function isValidTemporal(type,value){if(typeof value!=="string")return false;if(type==="time")return/^([01]\d|2[0-3]):[0-5]\d$/.test(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T12:00:00`);return!Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value}
function dateKey(date){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
function noteFallbackTitle(text){return String(text||"").replace(/^\s*(?:apunta|anota|guarda)(?:me)?\s+(?:una\s+)?nota\s*(?:de|sobre|para|:)?\s*/i,"").replace(/[.!?]+$/g,"").trim()||"Nota"}
function targetTitle(text,prefix){return cleanTemporalText((text||"").replace(prefix,"").replace(/\b(?:de|del)\s+(?:mañana|domingo|lunes|martes|miércoles|jueves|viernes|sábado)\b/gi,"").trim())}
function calendarTitle(text){return cleanTemporalText(text).replace(/^\s*(?:me\s+han\s+)?contratad[oa]\s+(?:una?\s+)?/i,"").replace(/^\s*tenemos?\s+(?:una?\s+)?/i,"").replace(/\s+en\s+[\p{L}][\p{L}\s-]{1,60}[.]?$/iu,"").replace(/\s+(?:para\s+(?:el\s+)?(?:d[ií]a)?|(?:el|la))\s*[.]?$/i,"").trim()||"Evento de Angeli Secretaria"}
function contactName(text){const match=(text||"").match(/\b(?:llama(?:r)?|telefonea(?:r)?|contacta(?:r)?)\s+(?:a\s+|al\s+)?(.+?)(?:[.!?,;]|$)/i);if(!match)return null;const value=cleanTemporalText(match[1]).replace(/\b(?:mañana|hoy|luego|por favor)\b.*$/i,"").trim();return value||null}
function location(text){const match=(text||"").match(/\ben\s+([\p{L}][\p{L}\d\s,.'’-]{1,100})(?:[.!?;]|$)/iu);return match?match[1].trim().replace(/[,.]+$/,""):null}
function completionTitle(text){return(text||"").replace(/^\s*(?:ya\s+)?(?:he\s+)?(?:llamado|terminado|completado|hecho)\s+(?:a\s+)?/i,"").replace(/[.!?,;]+$/g,"").trim()||"Pendiente"}
