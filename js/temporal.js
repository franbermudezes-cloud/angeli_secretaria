// Utilidades de fecha y hora del respaldo local (AGENTS.md: solo temporal).
//
// 3ª auditoría: este módulo se reescribió de forma legible porque sus reglas
// se usan también para COMPLETAR respuestas de la IA, y fallaban en lo más
// habitual del dictado: «a las 9 y media de la noche» -> 09:00, «a las 7 menos
// cuarto» -> 07:00, «mañana a las 8» (recordatorio) -> 20:00, «este viernes»
// dicho un viernes -> el viernes siguiente, «esta mañana» -> mañana, «a la
// una», «sobre las 9», «el día 20», «a mediodía», escribir sin tildes, y
// títulos con restos como «Dentista pasado» o búsquedas por «que viene».
// Todo el análisis se hace sobre un texto en minúsculas y sin tildes.

const MONTHS={enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,julio:6,agosto:7,septiembre:8,setiembre:8,octubre:9,noviembre:10,diciembre:11};
const WEEKDAYS={domingo:0,lunes:1,martes:2,miercoles:3,jueves:4,viernes:5,sabado:6};
const NUMBER_WORDS={un:1,una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veinticinco:25,treinta:30,cuarenta:40,cincuenta:50};
const HOUR_WORDS="una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce";
const MINUTE_WORDS="cinco|diez|quince|veinte|veinticinco|treinta|cuarenta|cincuenta";
const COUNT_WORDS="un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte";
const WEEKDAY_WORDS="domingo|lunes|martes|miercoles|jueves|viernes|sabado";
const MONTH_WORDS="enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const PART_PHRASE=`(?:de|por|en)\\s+la\\s+(manana|tarde|noche|madrugada)`;

function plain(text){return String(text||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function toNumber(raw){return /^\d+$/.test(raw)?Number(raw):NUMBER_WORDS[raw]}
function addDays(date,days){const next=new Date(date);next.setDate(next.getDate()+days);return next}

// «En/dentro de N días/semanas» (p. ej. «si Ana no me contesta en dos días,
// recuérdamelo»). Acepta dígitos y números escritos hasta veinte.
function relativeDaysOffset(value){
  const match=value.match(new RegExp(`\\b(?:en|dentro\\s+de)\\s+(\\d{1,2}|${COUNT_WORDS})\\s+(dias?|semanas?)\\b`));
  if(!match)return null;
  const n=toNumber(match[1]);
  const days=/^semana/.test(match[2])?n*7:n;
  return Number.isInteger(days)&&days>0&&days<=90?days:null;
}

// «hoy / mañana / pasado mañana / esta tarde / en N días». «Esta mañana», «a
// media mañana» y «por/de la mañana» hablan de la MAÑANA (franja), no de
// mañana. Si hay varias, gana la PRIMERA que se dice: en «Recuérdame hoy a las
// once que mañana tengo médico» el aviso es hoy, y «mañana» es el contenido.
function relativeCandidate(text){
  const value=plain(text).replace(/\b(?:de|por|en)\s+la\s+manana\b|\b(?:a\s+)?media\s+manana\b/g,m=>" ".repeat(m.length));
  const found=[];
  const push=(regex,days)=>{const match=regex.exec(value);if(match)found.push({index:match.index,days})};
  push(/\bpasado\s+manana\b/,2);
  push(/\besta\s+(?:manana|tarde|noche)\b/,0);
  push(/\bhoy\b/,0);
  const masked=value.replace(/\bpasado\s+manana\b|\besta\s+manana\b/g,m=>" ".repeat(m.length));
  const tomorrow=/\bmanana\b/.exec(masked);
  if(tomorrow)found.push({index:tomorrow.index,days:1});
  const offsetMatch=value.match(new RegExp(`\\b(?:en|dentro\\s+de)\\s+(?:\\d{1,2}|${COUNT_WORDS})\\s+(?:dias?|semanas?)\\b`));
  const offset=relativeDaysOffset(value);
  if(offset!==null&&offsetMatch)found.push({index:offsetMatch.index,days:offset});
  found.sort((a,b)=>a.index-b.index);
  return found[0]||null;
}
export function explicitRelativeDate(text,now=new Date()){
  const candidate=relativeCandidate(text);
  return candidate?toDateKey(addDays(now,candidate.days)):null;
}

// Solo los recordatorios pueden inferir "hoy" a partir de una hora. Un evento
// sin fecha sigue requiriendo que la persona confirme su día explícitamente.
export function temporalData(text,now=new Date(),{inferDateFromTime=false}={}){
  const value=plain(text),data={};
  let date=extractDate(value,now);
  const time=extractTime(value,now,{inferDateFromTime,hasDate:Boolean(date)});
  if(date&&time?.nextDay)date=addDays(date,1);
  if(date)data.scheduledDate=toDateKey(date);
  if(time){
    data.scheduledTime=`${String(time.hour).padStart(2,"0")}:${String(time.minute).padStart(2,"0")}`;
    if(!data.scheduledDate&&inferDateFromTime)data.scheduledDate=toDateKey(time.date||nextDateForTime(data.scheduledTime,now));
  }
  return data;
}

export function nextDateForTime(time,now=new Date()){
  const [hour,minute]=String(time||"").split(":").map(Number);
  if(!Number.isInteger(hour)||!Number.isInteger(minute))return new Date(now);
  const candidate=new Date(now);
  candidate.setSeconds(0,0);
  candidate.setHours(hour,minute,0,0);
  if(candidate.getTime()<=now.getTime())candidate.setDate(candidate.getDate()+1);
  return candidate;
}

export function calendarQueryRange(text,now=new Date()){
  const value=plain(text);
  if(/\b(?:la\s+)?(?:semana\s+que\s+viene|proxima\s+semana)\b/.test(value)){const start=addDays(startOfWeek(now),7);return range(start,addDays(start,7))}
  if(/\besta\s+semana\b/.test(value)){const start=startOfWeek(now);return range(start,addDays(start,7))}
  // 3ª auditoría: «el fin de semana», «este mes» o «el mes que viene» caían
  // en la ventana por defecto de 90 días (y en el atajo directo de agenda,
  // que no pasa por la IA, era lo único disponible).
  if(/\b(?:este\s+|el\s+)?fin\s+de\s+semana\b/.test(value)){
    const today=startOfToday(now),day=today.getDay();
    const start=day===0?today:addDays(today,(6-day+7)%7);
    return range(start,addDays(start,day===0?1:2));
  }
  if(/\b(?:el\s+)?mes\s+que\s+viene\b|\bproximo\s+mes\b/.test(value)){const start=new Date(now.getFullYear(),now.getMonth()+1,1);return range(start,new Date(now.getFullYear(),now.getMonth()+2,1))}
  if(/\b(?:este|del)\s+mes\b/.test(value)){const start=new Date(now.getFullYear(),now.getMonth(),1);return range(start,new Date(now.getFullYear(),now.getMonth()+1,1))}
  const date=extractDate(value,now);
  if(!date)return null;
  const start=startOfDay(date);
  return range(start,addDays(start,1));
}

export function naturalQueryRange(text,now=new Date()){
  const value=plain(text),start=startOfToday(now);
  const previous=value.match(/(?:^|\s)(?:ultimos|anteriores)\s+(\d{1,3})\s+dias?/);
  if(previous)return range(addDays(start,-Math.min(Number(previous[1]),365)),addDays(start,1));
  const next=value.match(/(?:^|\s)(?:proximos|siguientes)\s+(\d{1,3})\s+dias?/);
  if(next)return range(start,addDays(start,Math.min(Number(next[1]),365)+1));
  return calendarQueryRange(text,now);
}

function extractDate(value,now){
  const today=startOfToday(now),found=[];
  const relative=relativeCandidate(value);
  if(relative)found.push({index:relative.index,date:addDays(today,relative.days)});
  const numeric=/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(value);
  if(numeric){
    const day=Number(numeric[1]),month=Number(numeric[2])-1;
    let date=numeric[3]?validDate(Number(numeric[3]),month,day):validDate(now.getFullYear(),month,day);
    if(date&&!numeric[3]&&date<today)date=validDate(now.getFullYear()+1,month,day);
    if(date)found.push({index:numeric.index,date});
  }
  const named=new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTH_WORDS})(?:\\s+(?:de|del)\\s+(\\d{4}|ano\\s+que\\s+viene|proximo\\s+ano))?\\b`).exec(value);
  if(named){
    const explicitYear=named[3]&&/^\d{4}$/.test(named[3])?Number(named[3]):null;
    const year=explicitYear??(named[3]?now.getFullYear()+1:now.getFullYear());
    let date=validDate(year,MONTHS[named[2]],Number(named[1]));
    if(date&&!named[3]&&date<today)date=validDate(year+1,MONTHS[named[2]],Number(named[1]));
    if(date)found.push({index:named.index,date});
  }
  // «el día 20» / «el 20» (sin mes): este mes si aún no ha pasado; si no, el siguiente.
  const dayOnly=/\bel\s+(?:dia\s+)?(\d{1,2})\b(?!\s*(?:de\s+(?:la|las)\b|[:./]\d|h\b|\s+(?:horas?|minutos?|euros?|%|de\s+(?:${MONTH_WORDS}))))/.exec(value.replace(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(?:${MONTH_WORDS})`,"g"),m=>" ".repeat(m.length)));
  if(dayOnly){
    const day=Number(dayOnly[1]);
    if(day>=1&&day<=31){
      let date=validDate(now.getFullYear(),now.getMonth(),day);
      if(!date||date<today)date=validDate(now.getFullYear(),now.getMonth()+1,day)||validDate(now.getFullYear(),now.getMonth()+2,day);
      if(date)found.push({index:dayOnly.index,date});
    }
  }
  const weekday=new RegExp(`\\b(?:(este|esta|el\\s+proximo|proximo|el)\\s+)?(${WEEKDAY_WORDS})(\\s+que\\s+viene|\\s+proximo)?\\b`).exec(value);
  if(weekday){
    const target=WEEKDAYS[weekday[2]],base=(target-today.getDay()+7)%7;
    const modifier=weekday[1]||"";
    // «este viernes» dicho un viernes es HOY; «el viernes» a secas, «el
    // próximo viernes» o «el viernes que viene», dichos un viernes, son dentro
    // de una semana.
    const delta=base===0?(/^est[ea]$/.test(modifier)?0:7):base;
    found.push({index:weekday.index,date:addDays(today,delta)});
  }
  if(!found.length)return null;
  found.sort((a,b)=>a.index-b.index);
  return found[0].date;
}

// Hora dictada. Devuelve {hour, minute, nextDay?, date?}.
function extractTime(value,now,{inferDateFromTime=false,hasDate=false}={}){
  if(/\ba\s+(?:el\s+)?mediodia\b/.test(value))return{hour:12,minute:0};
  if(/\ba\s+(?:la\s+)?medianoche\b/.test(value))return{hour:0,minute:0,nextDay:true};
  const lead=`(?:\\ba|\\bsobre|\\bhacia|\\ba\\s+eso\\s+de)\\s+las?\\s+`;
  const minutes=`(?:[:.h](\\d{2})|\\s+(y\\s+media|y\\s+cuarto|menos\\s+cuarto|y\\s+(?:\\d{1,2}|${MINUTE_WORDS})(?:\\s+minutos?)?|menos\\s+(?:\\d{1,2}|${MINUTE_WORDS})(?:\\s+minutos?)?))?`;
  const suffix=`(?:\\s+horas?)?(?:\\s+${PART_PHRASE}|\\s+(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![a-z])|\\s+del\\s+mediodia)?`;
  let match=value.match(new RegExp(`${lead}(2[0-4]|[01]?\\d|${HOUR_WORDS})(?!\\d)${minutes}${suffix}`));
  if(!match){
    // «las 21:30», «9 de la noche» sin «a las».
    const bare=value.match(new RegExp(`\\b(2[0-4]|[01]?\\d)(?:[:.h](\\d{2}))()${suffix}(?![\\d/])`))||value.match(new RegExp(`\\b(2[0-4]|[01]?\\d|${HOUR_WORDS})()()\\s+${PART_PHRASE}`));
    if(!bare)return null;
    match=bare;
  }
  let hour=toNumber(match[1]);
  let minute=match[2]?Number(match[2]):0;
  const extra=match[3]||"";
  if(extra==="y media")minute=30;
  else if(extra==="y cuarto")minute=15;
  else if(extra==="menos cuarto"){hour-=1;minute=45}
  else if(/^y\s/.test(extra))minute=toNumber(extra.replace(/^y\s+/,"").replace(/\s+minutos?$/,""));
  else if(/^menos\s/.test(extra)){hour-=1;minute=60-toNumber(extra.replace(/^menos\s+/,"").replace(/\s+minutos?$/,""))}
  if(!Number.isInteger(hour)||!Number.isInteger(minute)||minute<0||minute>59)return null;
  if(hour<0)hour=12;
  const meridiem=match[5]?(/^p/.test(match[5])?"pm":"am"):null;
  // Franja dicha fuera de la hora: «mañana por la mañana a las 9», «esta tarde a las 5».
  const part=match[4]||(/\bdel\s+mediodia\b/.test(match[0])?"mediodia":null)||value.match(new RegExp(PART_PHRASE))?.[1]||value.match(/\besta\s+(tarde|noche)\b/)?.[1]||null;
  return normalizeHour(hour,minute,part,meridiem,now,{inferDateFromTime,hasDate});
}

function normalizeHour(hour,minute,part,meridiem,now,{inferDateFromTime,hasDate}){
  if(hour===24)return{hour:0,minute,nextDay:true};
  if(meridiem==="pm"&&hour<12)return{hour:hour+12,minute};
  if(meridiem==="am")return{hour:hour===12?0:hour,minute};
  if(part==="madrugada")return{hour:hour===12?0:hour,minute};
  if(part==="manana"||part==="mediodia")return{hour,minute};
  if(part==="tarde")return{hour:hour<12?hour+12:hour,minute};
  if(part==="noche"){
    if(hour===12)return{hour:0,minute,nextDay:true};
    // «a las 2 de la noche» son las 02:00; «a las 11 de la noche», las 23:00.
    return{hour:hour<12&&hour>=6?hour+12:hour,minute};
  }
  if(hour>12)return{hour,minute};
  // Sin franja ni día (recordatorio «a las 9»): la próxima vez que llegue esa hora.
  if(inferDateFromTime&&!hasDate&&hour>=1&&hour<=12){
    const candidates=[hour===12?12:hour,hour===12?0:hour+12].map(value=>({hour:value,minute,date:nextDateForTime(`${String(value).padStart(2,"0")}:${String(minute).padStart(2,"0")}`,now)}));
    candidates.sort((a,b)=>a.date-b.date);
    return candidates[0];
  }
  // Con día dicho (o en un evento): «a las 12» es mediodía, de 1 a 6 es por la
  // tarde (nadie cita a las 5 de la madrugada sin decirlo) y de 7 a 11, por la mañana.
  if(hour>=1&&hour<=6)return{hour:hour+12,minute};
  return{hour,minute};
}

function range(start,end){return{rangeStart:toDateKey(start),rangeEnd:toDateKey(end)}}
function validDate(year,month,day){const date=new Date(year,month,day,12),ref=new Date(year,month,1,12);return date.getFullYear()===ref.getFullYear()&&date.getMonth()===ref.getMonth()&&date.getDate()===day?date:null}
function startOfDay(date){return new Date(date.getFullYear(),date.getMonth(),date.getDate())}
function startOfToday(now){return startOfDay(now)}
function startOfWeek(now){const date=startOfToday(now),offset=(date.getDay()+6)%7;date.setDate(date.getDate()-offset);return date}
function toDateKey(date){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}

// Título sin la parte temporal. Opera sobre el texto original (conserva
// mayúsculas y tildes) con patrones que aceptan escribir sin tildes, y quita
// primero las expresiones largas para que no queden restos como «pasado»,
// «que viene», «de la» o «este».
const A="[aá]",E="[eé]",I="[ií]",O="[oó]",N="[nñ]";
const T_MANANA=`ma${N}ana`,T_DIA=`d${I}as?`,T_MIERCOLES=`mi${E}rcoles`,T_SABADO=`s${A}bado`,T_PROXIMO=`pr${O}xim[oa]`;
const T_WEEKDAYS=`domingo|lunes|martes|${T_MIERCOLES}|jueves|viernes|${T_SABADO}`;
const T_TIME=`(?:2[0-4]|[01]?\\d|${HOUR_WORDS})(?:[:.h]\\d{2})?(?:\\s+(?:y\\s+media|y\\s+cuarto|menos\\s+cuarto|y\\s+(?:\\d{1,2}|${MINUTE_WORDS})(?:\\s+minutos?)?|menos\\s+(?:\\d{1,2}|${MINUTE_WORDS})))?(?:\\s+horas?)?(?:\\s+(?:de|por|en)\\s+la\\s+(?:${T_MANANA}|tarde|noche|madrugada)|\\s+(?:a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![a-z])|\\s+del\\s+mediod${I}a)?`;
const TITLE_PATTERNS=[
  new RegExp(`\\b(?:en|dentro\\s+de)\\s+(?:\\d{1,2}|${COUNT_WORDS.replace("dieciseis",`dieci(?:s${E})is`)})\\s+(?:${T_DIA}|semanas?)\\b`,"gi"),
  new RegExp(`\\b(?:para\\s+)?pasado\\s+${T_MANANA}\\b`,"gi"),
  new RegExp(`\\b(?:(?:a|sobre|hacia|a\\s+eso\\s+de)\\s+las?\\s+)${T_TIME}(?!\\d)`,"gi"),
  new RegExp(`\\b(?:a\\s+)?(?:(?:el\\s+)?mediod${I}a|(?:la\\s+)?medianoche)\\b`,"gi"),
  new RegExp(`\\b(?:(?:de|por|en)\\s+la|esta|a\\s+media)\\s+(?:${T_MANANA}|tarde|noche|madrugada)\\b`,"gi"),
  new RegExp(`\\b(?:para\\s+)?(?:el\\s+|este\\s+|esta\\s+|del\\s+)?(?:${T_PROXIMO}\\s+)?(?:${T_WEEKDAYS})(?:\\s+que\\s+viene|\\s+${T_PROXIMO})?\\b`,"gi"),
  new RegExp(`\\b(?:para\\s+(?:el\\s+)?|del\\s+|el\\s+)?\\d{1,2}\\s+de\\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\\s+(?:de|del)\\s+(?:\\d{4}|a${N}o\\s+que\\s+viene|${T_PROXIMO}\\s+a${N}o))?\\b`,"gi"),
  /\b(?:para\s+(?:el\s+)?|del\s+|el\s+)?\d{1,2}\/\d{1,2}(?:\/\d{4})?\b/gi,
  new RegExp(`\\b(?:para\\s+|de\\s+)?(?:hoy|${T_MANANA})\\b`,"gi"),
  /\b(?:2[0-3]|[01]?\d):[0-5]\d\b/g
];
export function cleanTemporalText(text){
  let value=String(text||"").replace(/^\s*(?:apunta(?:\s+en\s+el\s+calendario)?|a[ñn]ade(?:\s+al\s+calendario)?|agrega(?:\s+al\s+calendario)?)\b\s*/i,"");
  for(const pattern of TITLE_PATTERNS)value=value.replace(pattern," ");
  return value.replace(/\s{2,}/g," ").replace(/\s+([,.:;-])/g,"$1").replace(/(?:\s+(?:de|del|a|al|para|el|la|en|con))+\s*$/i,"").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,"").trim()||"Evento de Angeli Secretaria";
}
