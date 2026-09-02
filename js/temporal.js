const MONTHS={enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,julio:6,agosto:7,septiembre:8,octubre:9,noviembre:10,diciembre:11};
const WEEKDAYS={domingo:0,lunes:1,martes:2,miércoles:3,jueves:4,viernes:5,sábado:6};
const HOURS={una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12};

export function explicitRelativeDate(text,now=new Date()){
  const value=String(text||"").toLowerCase().replace(/\b(?:de|por)\s+la\s+mañana\b/g,"");
  const days=/\bpasado\s+mañana\b/.test(value)?2:/\bmañana\b/.test(value)?1:/\bhoy\b/.test(value)?0:null;
  if(days===null)return null;
  const date=new Date(now);date.setDate(date.getDate()+days);return toDateKey(date);
}

// Solo los recordatorios pueden inferir "hoy" a partir de una hora. Un evento
// sin fecha sigue requiriendo que la persona confirme su día explícitamente.
export function temporalData(text,now=new Date(),{inferDateFromTime=false}={}){const value=(text||"").toLowerCase(),data={},date=extractDate(value,now),time=extractTime(value,now,inferDateFromTime);if(date)data.scheduledDate=toDateKey(date);if(time){data.scheduledTime=`${String(time.hour).padStart(2,"0")}:${String(time.minute).padStart(2,"0")}`;if(!data.scheduledDate&&inferDateFromTime)data.scheduledDate=toDateKey(nextDateForTime(data.scheduledTime,now))}return data}
export function nextDateForTime(time,now=new Date()){const [hour,minute]=String(time||"").split(":").map(Number);if(!Number.isInteger(hour)||!Number.isInteger(minute))return new Date(now);const candidate=new Date(now);candidate.setSeconds(0,0);candidate.setHours(hour,minute,0,0);if(candidate.getTime()<=now.getTime())candidate.setDate(candidate.getDate()+1);return candidate}
export function calendarQueryRange(text,now=new Date()){const value=(text||"").toLowerCase();if(/\b(?:la\s+)?(?:semana\s+que\s+viene|próxima\s+semana)\b/.test(value)){const start=startOfWeek(now);start.setDate(start.getDate()+7);const end=new Date(start);end.setDate(end.getDate()+7);return{rangeStart:toDateKey(start),rangeEnd:toDateKey(end)}}if(/\besta\s+semana\b/.test(value)){const start=startOfWeek(now),end=new Date(start);end.setDate(end.getDate()+7);return{rangeStart:toDateKey(start),rangeEnd:toDateKey(end)}}const date=extractDate(value,now);if(!date)return null;const start=toDateKey(date),end=new Date(date);end.setDate(end.getDate()+1);return{rangeStart:start,rangeEnd:toDateKey(end)}}

export function naturalQueryRange(text,now=new Date()){
  const value=String(text||"").toLowerCase(),start=startOfToday(now),end=new Date(start);
  const previous=value.match(/(?:^|\s)(?:últimos|ultimos|anteriores)\s+(\d{1,3})\s+días?/);
  if(previous){start.setDate(start.getDate()-Math.min(Number(previous[1]),365));end.setDate(end.getDate()+1);return{rangeStart:toDateKey(start),rangeEnd:toDateKey(end)}}
  const next=value.match(/(?:^|\s)(?:próximos|proximos|siguientes)\s+(\d{1,3})\s+días?/);
  if(next){end.setDate(end.getDate()+Math.min(Number(next[1]),365)+1);return{rangeStart:toDateKey(start),rangeEnd:toDateKey(end)}}
  if(/\b(?:este|del)\s+mes\b/.test(value)){start.setDate(1);end.setMonth(end.getMonth()+1,1);return{rangeStart:toDateKey(start),rangeEnd:toDateKey(end)}}
  return calendarQueryRange(text,now);
}

function extractDate(value,now){const relative=explicitRelativeDate(value,now);if(relative)return new Date(`${relative}T12:00:00`);const numeric=value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);if(numeric)return validDate(Number(numeric[3]),Number(numeric[2])-1,Number(numeric[1]));const named=value.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/);if(named){let year=named[3]?Number(named[3]):now.getFullYear(),date=validDate(year,MONTHS[named[2]],Number(named[1]));if(date&&!named[3]&&date<startOfToday(now))date=validDate(year+1,MONTHS[named[2]],Number(named[1]));return date}const weekday=value.match(/\b(domingo|lunes|martes|miércoles|jueves|viernes|sábado)\b/);if(weekday){const date=new Date(now),target=WEEKDAYS[weekday[1]],delta=(target-date.getDay()+7)%7||7;date.setDate(date.getDate()+delta);return date}return null}
function extractTime(value,now,inferDateFromTime){const numeric=value.match(/(?:\ba\s+las\s+)(2[0-3]|[01]?\d)(?:(?::|\s+y\s+)([0-5]?\d)(?:\s+minutos?)?)?(?:\s+de\s+la\s+(mañana|tarde|noche))?|\b(2[0-3]|[01]?\d):([0-5]\d)\b/);if(numeric){const hour=Number(numeric[1]||numeric[4]),minute=Number(numeric[2]||numeric[5]||0),part=numeric[3]||null;return normalizeHour(hour,minute,part,now,inferDateFromTime)}const words=value.match(/\ba\s+las\s+(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s+(y\s+media|y\s+cuarto|menos\s+cuarto))?(?:\s+de\s+la\s+(mañana|tarde|noche))?\b/);if(!words)return null;let hour=HOURS[words[1]],minute=0;if(words[2]==="y media")minute=30;if(words[2]==="y cuarto")minute=15;if(words[2]==="menos cuarto"){hour=hour===1?12:hour-1;minute=45}return normalizeHour(hour,minute,words[3]||null,now,inferDateFromTime)}
function normalizeHour(hour,minute,part,now,inferDateFromTime){if(part==="tarde"&&hour<12)hour+=12;if(part==="noche"){if(hour===12)hour=0;else if(hour<12)hour+=12}if(!part&&inferDateFromTime&&hour>=1&&hour<=12){const candidates=[hour,hour===12?0:hour+12].map(value=>({hour:value,minute,date:nextDateForTime(`${String(value).padStart(2,"0")}:${String(minute).padStart(2,"0")}`,now)}));candidates.sort((a,b)=>a.date-b.date);return candidates[0]}return{hour,minute}}
function validDate(year,month,day){const date=new Date(year,month,day,12);return date.getFullYear()===year&&date.getMonth()===month&&date.getDate()===day?date:null}
function startOfToday(now){return new Date(now.getFullYear(),now.getMonth(),now.getDate())}
function startOfWeek(now){const date=startOfToday(now),offset=(date.getDay()+6)%7;date.setDate(date.getDate()-offset);return date}
function toDateKey(date){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}

export function cleanTemporalText(text){return(text||"").replace(/^\s*(?:apunta(?:\s+en\s+el\s+calendario)?|añade(?:\s+al\s+calendario)?|agrega(?:\s+al\s+calendario)?)\b\s*/i,"").replace(/\b(?:para\s+(?:el\s+)?)?(?:hoy|mañana|domingo|lunes|martes|miércoles|jueves|viernes|sábado|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?)\b/gi,"").replace(/\ba\s+las\s+(?:(?:2[0-3]|[01]?\d)(?:(?::|\s+y\s+)[0-5]?\d(?:\s+minutos?)?)?|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s+(?:y\s+media|y\s+cuarto|menos\s+cuarto))?(?:\s+de\s+la\s+(?:mañana|tarde|noche))?\b/gi,"").replace(/\b(?:2[0-3]|[01]?\d):[0-5]\d\b/g,"").replace(/\s{2,}/g," ").replace(/\s+([,.:;-])/g,"$1").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,"").trim()||"Evento de Angeli Secretaria"}
