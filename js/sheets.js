const SHEETS_ENDPOINT="https://script.google.com/macros/s/AKfycbyyQ8VGgw45D-gRVnAmYs4nifEayZV1JhTc8u9ywtsMsqfJpHmwD8iL_AQFKJ1p5r-2WA/exec";

function mediaItems(entry){return[...(entry.images||[]),...(entry.files||[])]}
function mediaName(item){return typeof item==="string"?"":item?.name||""}
function mediaUrl(item){
 if(typeof item==="string")return item.startsWith("http")?item:"";
 if(item?.url)return item.url;
 const id=item?.driveFileId||item?.id;
 return id?`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`:"";
}

export function sheetsPayload(entry,now){
 const items=mediaItems(entry);
 return{id:entry.id,fecha:now.toLocaleDateString("es-ES"),hora:now.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}),entrada:entry.text||"Entrada con archivo o imagen",estado:"Pendiente",tipo:entry.type,origen:"Angeli Secretaria V0.8",archivo:items.map(mediaName).filter(Boolean).join(" · "),enlace:items.map(mediaUrl).filter(Boolean).join(" · "),creadoPor:"Angeli Secretaria V0.8"};
}

export async function sendEntry(entry,now){await fetch(SHEETS_ENDPOINT,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(sheetsPayload(entry,now))})}
