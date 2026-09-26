export const DEFAULT_NOTIFICATION_SETTINGS={atTime:true,beforeMinutes:0,afterMinutes:60,types:{reminders:true,calls:true,linked:true,tasks:true,events:false},quiet:{enabled:true,start:"22:30",end:"08:00",deliverAfter:true}};

const minutes=value=>Math.max(0,Math.min(10080,Number.isFinite(Number(value))?Math.round(Number(value)):0));
const clock=(value,fallback)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||""))?String(value):fallback;

export function normalizeNotificationSettings(value={}){
 const types=value.types||{},quiet=value.quiet||{};
 return{atTime:value.atTime!==false,beforeMinutes:minutes(value.beforeMinutes??DEFAULT_NOTIFICATION_SETTINGS.beforeMinutes),afterMinutes:minutes(value.afterMinutes??DEFAULT_NOTIFICATION_SETTINGS.afterMinutes),types:{reminders:types.reminders!==false,calls:types.calls!==false,linked:types.linked!==false,tasks:types.tasks!==false,events:types.events===true},quiet:{enabled:quiet.enabled!==false,start:clock(quiet.start,"22:30"),end:clock(quiet.end,"08:00"),deliverAfter:quiet.deliverAfter!==false}};
}

// Al guardar los ajustes de avisos se reprograman los avisos de las entradas.
// Solo las que aún pueden sonar: lo pasado (más de un día) ya no avisa, y
// mandarlo todo de golpe chocaba con el límite de 30 peticiones por minuto
// del servidor (reportado en real: de 40 avisos, 20 rechazados).
export function entriesToReschedule(entries=[],now=new Date()){
 const cutoff=now.getTime()-24*60*60*1000;
 return entries.filter(entry=>entry?.schedule?.status==="scheduled"||(entry?.type==="calendar"&&entry.calendarStatus==="synced")||(entry?.type==="task"&&entry.status==="pending"&&entry.scheduledDate&&entry.scheduledTime)).filter(entry=>{
  const due=entry.schedule?.dueAt||(entry.scheduledDate&&entry.scheduledTime?`${entry.scheduledDate}T${entry.scheduledTime}:00`:"");
  const time=Date.parse(due);
  return Number.isFinite(time)&&time>=cutoff;
 });
}

// Ejecuta las tareas de pocas en pocas (no todas a la vez) y devuelve cuántas fallaron.
export async function runInBatches(items=[],task,size=3){
 let failed=0;
 for(let index=0;index<items.length;index+=size){
  const results=await Promise.allSettled(items.slice(index,index+size).map(task));
  failed+=results.filter(result=>result.status==="rejected").length;
 }
 return failed;
}

