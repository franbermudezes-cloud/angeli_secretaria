import{clearNotes,deleteMediaDB,readShortcuts,writeShortcuts}from"./storage.js?v=0.21.25";
import{classify,actionData}from"./classifier.js?v=0.21.25";
import{sendEntry}from"./sheets.js?v=0.21.25";
import{createUI}from"./ui.js?v=0.21.25";
import{createGoogleIntegration}from"./google.js?v=0.21.25";
import{interpret,remoteProvider,localReminderQuery,localCalendarCancellation,localCalendarUpdate,protectCalendarInterpretation}from"./ai.js?v=0.21.25";
import{entryTypeForIntent,planIntent}from"./intents.js?v=0.21.25";
import{calendarQueryRange,temporalData}from"./temporal.js?v=0.21.25";
import{normalizeFutureCall,normalizeReminderSchedule,normalizeUndatedCall,deferredCallIntent,scheduleFor,updateCalendarDetails}from"./schedule.js?v=0.21.25";
import{createCloudSync}from"./firebase.js?v=0.21.25";
import{createMediaService}from"./media.js?v=0.21.25";
import{cancelInteraction,completeInteraction,contextFor,resolveConversationTurn,preserveCancellation}from"./conversation.js?v=0.21.25";
import{completionTarget,completePendingWithCalendar,findPendingMatches,findReminderMatches,markCancelledReminder}from"./pending.js?v=0.21.25";
import{createAgendaActions}from"./agenda.js?v=0.21.25";

let media;const ui=createUI({getMedia:(_,id)=>media.getMedia(id)});const $=ui.$;
let notes=[],rec=null,listening=false,finalText="",pendingImages=[],pendingFiles=[],selectedFilter="all",selectedType="all",shortcutCapture=false,saving=false;
const DEFAULT_SHORTCUTS=[
 {label:"🗓️ Hoy",command:"¿Qué tengo hoy?"},{label:"🗓️ Próxima semana",command:"¿Qué tengo la semana que viene?"},
 {label:"📞 Llamar contacto",prompt:"Di el nombre del contacto.",prefix:"Llama a ",dictate:true},{label:"＋ Nuevo evento",prompt:"Cuéntame el evento: fecha, hora y lugar."},
 {label:"⏰ Recordatorio",prompt:"¿Qué quieres que te recuerde y cuándo?"},{label:"✕ Cancelar evento",prompt:"¿Qué evento quieres cancelar?"}
];
let shortcuts=readShortcuts()||DEFAULT_SHORTCUTS;
function render(){ui.render({notes,selectedFilter,selectedType,google})}
function autosize(){const text=$("text");text.style.height="auto";text.style.height=Math.min(text.scrollHeight,78)+"px"}
function renderShortcuts(){$("shortcuts").innerHTML=shortcuts.map((shortcut,index)=>`<button class="shortcut" data-shortcut="${index}">${esc(shortcut.label)}</button>`).join("")+`<button class="shortcut add" id="shortcutAdd" aria-label="Crear acceso directo">＋</button>`}
function saveShortcuts(){writeShortcuts(shortcuts);renderShortcuts()}
function prepareShortcut(shortcut){if(shortcut.command){$("text").value=shortcut.command;autosize();add();return}const legacyCall=shortcut.label==="📞 Llamar contacto"?"Llama a ":"",prefix=shortcut.prefix||legacyCall;$("text").value=prefix;$("text").placeholder=shortcut.prompt||"Escribe o dicta tu instrucción…";autosize();openDraft();if(shortcut.dictate||legacyCall)setTimeout(start,120);else ui.notify(shortcut.prompt||"Completa la instrucción y pulsa Enviar")}
function createShortcut(initial=""){const command=prompt("Escribe la orden que ejecutará Angeli.",initial);if(!command?.trim())return;const label=prompt("Nombre corto para el acceso directo.",command.trim().slice(0,24));if(!label?.trim())return;shortcuts.push({label:label.trim(),command:command.trim()});saveShortcuts();ui.notify("Acceso directo creado")}
function editShortcuts(){if(!shortcuts.length){ui.notify("No hay accesos para editar");return}const choices=shortcuts.map((shortcut,index)=>`${index+1}. ${shortcut.label}`).join("\n"),value=prompt(`Indica el número del acceso que quieres eliminar:\n${choices}`);const index=Number(value)-1;if(!Number.isInteger(index)||!shortcuts[index])return;shortcuts.splice(index,1);saveShortcuts();ui.notify("Acceso directo eliminado")}
function scrollConversation(){requestAnimationFrame(()=>$("mainContent").scrollTo({top:$("mainContent").scrollHeight,behavior:"smooth"}))}
function setSending(active){["add","headerSend"].forEach(id=>{$(id).disabled=active});}
function clearPendingMedia(){pendingImages=[];pendingFiles=[];$("cameraInput").value="";$("photoInput").value="";$("fileInput").value="";$("preview").innerHTML="";}
async function saveConfirmed(nextNotes,previousNotes=notes){if(!cloud.isSignedIn()){ui.notify("Inicia sesión en Angeli antes de guardar");return false}notes=nextNotes;render();ui.setSyncStatus({state:"pending"});void cloud.syncNotes(nextNotes,previousNotes).catch(error=>{ui.setSyncStatus({state:"error",error});ui.notify("La instrucción sigue pendiente de sincronizar. Revisa Datos en Ajustes.")});return true}
function save(nextNotes,previousNotes=notes){void saveConfirmed(nextNotes,previousNotes);return true}
const cloud=createCloudSync({notify:ui.notify});
const google=createGoogleIntegration({notify:ui.notify,refresh:render,setStatus:ui.setGoogleStatus,saveNotes:save,getNotes:()=>notes,getAuthToken:cloud.getAuthToken,getSession:cloud.session});
media=createMediaService({getAuthToken:cloud.getAuthToken,ensureDrive:google.ensureDrive});
function openDraft(){ui.showDraft({value:$("text").value,onInput:value=>{$("text").value=value;finalText=value;autosize()},onSend:add,onMic:()=>start({inConversation:true}),onCancel:ui.closeLayers})}
// Una interacción solo puede continuar desde su propio popup. El compositor
// principal inicia siempre una instrucción nueva: una pregunta anterior no
// puede secuestrar órdenes posteriores como «llama a Montse».
function continueConversation(entry){ui.showInteractionQuestion(entry,{onSend:value=>{$("text").value=value;finalText=value;autosize();add({interactionId:entry.id})},onMic:()=>start({inConversation:true}),onCancel:()=>cancelActive(entry)})}
async function load(){notes=[];renderShortcuts();google.updateStatus();ui.setSyncStatus({state:"connecting"});render();await cloud.initialize({onRemoteNotes:remote=>{notes=remote;render()},onSyncStatus:ui.setSyncStatus,onAuthChange:async()=>{google.updateStatus();if(cloud.isSignedIn())await google.syncLinks();render()}});render();ui.dismissWelcome()}
async function add({interactionId=null}={}){
 if(saving)return;
 const text=$("text").value.trim(),active=interactionId?notes.find(item=>item.id===interactionId&&item.interaction?.status==="awaiting_input")||null:null;
 if(!text&&!pendingImages.length&&!pendingFiles.length){ui.notify("No hay nada que enviar");return}
 if(!cloud.isSignedIn()){ui.notify("Inicia sesión en Angeli antes de guardar");return}
 if(active?.interaction?.status==="pending_confirmation"){
   if(/^(?:sí|si|vale|de acuerdo|confirmo|adelante)\b/i.test(text)){clearComposer();ui.showEntryAction(active,google);return}
   if(/^(?:no|cancelar|cancela|anula|anular)\b/i.test(text)){await saveConfirmed(notes.map(item=>item.id===active.id?cancelInteraction(item):item));clearComposer();ui.closeLayers();ui.notify("Operación cancelada");return}
   ui.showEntryAction(active,google);return;
 }
 const now=new Date(),id=active?.id||crypto.randomUUID(),images=[],files=[],hasMedia=Boolean(pendingImages.length||pendingFiles.length);let mediaUploaded=false;saving=true;setSending(true);ui.showWorking("Procesando tu instrucción","Angeli ha recibido tu petición.","Un momento, no pulses Enviar otra vez.");try{
   if(hasMedia)ui.updateWorking("Subiendo adjunto","Angeli está enviando el archivo a Drive…","No pulses Enviar otra vez; te avisaré cuando termine.");
   for(const file of pendingImages){images.push(await media.upload(file,"image",id))}
   for(const file of pendingFiles){files.push(await media.upload(file,"file",id))}
   mediaUploaded=true;
   ui.updateWorking("Interpretando tu instrucción","Angeli está preparando la acción adecuada…","");
   const fallbackType=active?.type||classify(text,images,files);
   const localUpdate=localCalendarUpdate(text,now,active);
   const rawInterpretation=await interpret(text,{provider:(value,context)=>google.interpretWithAI(value,remoteProvider,context),fallback:()=>localCalendarCancellation(text)||localUpdate||localInterpretation(text,fallbackType,active),context:contextFor(active)});
   if(rawInterpretation.source==="fallback")ui.updateWorking("Estoy revisando tu petición","Necesito confirmarla contigo antes de continuar.","");
   const cancellation=localCalendarCancellation(text),deterministic=cancellation||localUpdate;
   const routedInterpretation=preserveCancellation(active,protectCalendarInterpretation(rawInterpretation,deterministic));
   const normalizedInterpretation=normalizeReminderSchedule(normalizeFutureCall(normalizeUndatedCall(routedInterpretation,text,active,now),text),text,now);
   if(normalizedInterpretation.intent==="task.complete"){await resolvePendingCompletion(normalizedInterpretation);return}
   if(normalizedInterpretation.intent==="reminder.query"){await resolveReminderQuery(normalizedInterpretation);return}
   const turn=resolveConversationTurn({active,text,interpretation:normalizedInterpretation,now:now.toISOString()});
   const interpretation=turn.interpretation,proposal=planIntent(interpretation,fallbackType),type=entryTypeForIntent(proposal,fallbackType);
   const data={...(interpretation.date?{scheduledDate:interpretation.date}:{}),...(interpretation.time?{scheduledTime:interpretation.time}:{}),...(interpretation.phone?{phone:interpretation.phone}:{}),...(interpretation.location?{location:interpretation.location}:{}),...(type==="calendar"&&interpretation.title?{calendarTitle:interpretation.title}:{}),...(type==="contact"&&interpretation.contactName?{contactQuery:interpretation.contactName}:{})};
   const schedule=scheduleFor(interpretation,active?.text||text);
   const entry={...(active||{}),id,date:active?.date||now.toISOString(),updatedAt:now.toISOString(),text:active?.text||text,status:active?.status||"pending",type,...data,aiIntent:interpretation,proposal,interaction:turn.interaction,...(proposal.intent==="calendar.create"?{calendarStatus:active?.calendarStatus||"pending"}:{}),...(schedule?{schedule}:{}),images:[...(active?.images||[]),...images],files:[...(active?.files||[]),...files]};
   ui.updateWorking("Guardando","Angeli está registrando tu instrucción…","");
   const nextNotes=active?notes.map(item=>item.id===active.id?entry:item):[entry,...notes];
   if(!await saveConfirmed(nextNotes)){if(hasMedia)await Promise.allSettled([...images,...files].map(item=>media.remove(item.driveFileId||item.id)));ui.closeLayers();return}
   clearComposer();
   if(!active){try{await sendEntry(entry,now);ui.notify("Entrada registrada en Google")}catch(e){ui.notify("Entrada sincronizada · Google Sheets no respondió")}}
   if(entry.interaction.status==="awaiting_input")continueConversation(entry);
   else {
     if(interpretation.intent==="calendar.delete"||interpretation.intent==="calendar.update"){
       ui.updateWorking("Buscando coincidencias",interpretation.intent==="calendar.delete"?"Angeli está buscando los eventos que quieres cancelar…":"Angeli está buscando el recordatorio que quieres modificar…","");
       await google.searchCalendar(entry);
     }
     ui.showEntryAction(entry,google);
   }
 }catch(error){
   if(hasMedia&&!mediaUploaded){clearPendingMedia();ui.closeLayers();ui.notify("No se pudo subir el adjunto. Se ha quitado de la petición; puedes volver a elegirlo e intentarlo.");return}
   if(mediaUploaded)await Promise.allSettled([...images,...files].map(item=>media.remove(item.driveFileId||item.id)));
   ui.closeLayers();ui.notify(error.message||"No se pudo guardar la entrada");
 }finally{saving=false;setSending(false)}
}
function clearComposer(){$("text").value="";$("text").placeholder="Escribe o dicta tu instrucción…";autosize();finalText="";clearPendingMedia()}
async function finishPending(entry){try{const completed=await completePendingWithCalendar(entry,item=>google.completeScheduledReminder(item));if(!await saveConfirmed(notes.map(item=>item.id===entry.id?completed:item)))return;clearComposer();ui.showCompletion({title:"✓ Pendiente completado",lead:`He marcado como hecho: ${entry.aiIntent?.title||entry.text}`})}catch(_){clearComposer();ui.showCompletion({title:"No he podido completar el pendiente",lead:"El aviso sigue activo en Calendar. Inténtalo de nuevo."})}}
async function resolvePendingCompletion(interpretation){const matches=findPendingMatches(notes,interpretation);clearComposer();if(!matches.length){ui.showCompletion({title:"No encuentro ese pendiente",lead:"No he creado ninguna entrada nueva."});return}if(matches.length===1){await finishPending(matches[0]);return}ui.showPendingChoices(matches,{onSelect:finishPending,onCancel:ui.closeLayers})}
async function resolveReminderQuery(interpretation){
 clearComposer();
 try{
  const reconciled=await google.reconcileScheduledReminders(notes);
  if(reconciled.some((entry,index)=>entry!==notes[index]))await saveConfirmed(reconciled,notes);
 }catch(_){ui.notify("No he podido comprobar ahora los avisos con Calendar. Te muestro los datos de Angeli.")}
 const matches=findReminderMatches(notes,interpretation);
 ui.showReminderResults(matches,interpretation.target?.title||"",{onSelect:entry=>ui.showReminderCancellation(entry)})
}
async function cancelActive(entry){await saveConfirmed(notes.map(item=>item.id===entry.id?cancelInteraction(item):item));ui.closeLayers();ui.notify("Operación cancelada")}
function localInterpretation(text,type,active=null){const query=localReminderQuery(text);if(query&&!active)return query;const reminder=type==="reminder"&&!active,data={...actionData(text,type),...temporalData(text,new Date(),{inferDateFromTime:reminder})},isCompletion=/\b(?:ya\s+)?he\s+(?:llamado|terminado|completado|hecho)\b/i.test(text),isCalendarQuery=/\b(?:qué|que)\s+(?:tengo|hay)|\b(?:muéstrame|muestrame|consulta)\s+(?:mi\s+)?(?:agenda|calendario)\b/i.test(text),futureCall=type==="contact"&&Boolean(data.scheduledDate||data.scheduledTime),intent=isCompletion?"task.complete":isCalendarQuery?"calendar.query":futureCall?"reminder.create":{note:"note",task:"task.create",reminder:"reminder.create",calendar:"calendar.create",contact:"contact.call",file:"file.store",photo:"photo.store"}[type]||"note";return{intent,confidence:.5,title:text||null,date:data.scheduledDate||null,time:data.scheduledTime||null,...(isCalendarQuery?(calendarQueryRange(text)||{}):{}),location:null,contactName:data.contactQuery||null,phone:data.phone||null,notes:null,target:isCompletion?{title:completionTarget(text)||text,date:null,time:null}:null,changes:null,missingFields:[],question:null,requiresConfirmation:Boolean(data.scheduledDate&&data.scheduledTime)}}
function setMicState(active){$("mic").classList.toggle("listening",active);$("micMini").classList.toggle("listening",active);document.querySelectorAll(".conversation-mic,.modal-actions .voice").forEach(button=>{button.classList.toggle("listening",active);button.textContent=active?"🎙️ Escuchando…":"🎙️ Hablar"});$("micLabel").textContent=active?"Escuchando… toca otra vez para parar":"Toca para hablar"}
function stop(){listening=false;if(rec){try{rec.stop()}catch(e){}}rec=null;setMicState(false);$("hint").textContent="Dictado terminado. Puedes continuar o pulsar Enviar cuando acabes.";autosize()}
function start({inConversation=false,draftId=null}={}){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){ui.notify("Este navegador no admite dictado");return}if(listening){stop();return}if(!inConversation)openDraft();const target=draftId?$(draftId):$("text");finalText=target?.value.trim()||"";rec=new SR();rec.lang="es-ES";rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=1;let sessionFinal=finalText||"",lastInterim="";const paint=value=>{if(target)target.value=value;if(!draftId){$("text").value=value;autosize()}ui.updateDraft(value)};rec.onstart=()=>{listening=true;setMicState(true);$("hint").textContent="Escuchando. Pulsa Enviar cuando la instrucción esté completa."};rec.onresult=e=>{let finalPart="",interimPart="";for(let i=e.resultIndex;i<e.results.length;i++){const result=e.results[i],phrase=(result[0]?.transcript||"").trim();if(!phrase)continue;if(result.isFinal)finalPart+=(finalPart?" ":"")+phrase;else interimPart+=(interimPart?" ":"")+phrase}if(finalPart){sessionFinal+=(sessionFinal?" ":"")+finalPart;lastInterim=""}else lastInterim=interimPart;finalText=sessionFinal;paint((sessionFinal+(lastInterim?" "+lastInterim:"")).trim())};rec.onerror=e=>{listening=false;setMicState(false);$("hint").textContent="Dictado detenido.";ui.notify(e.error==="not-allowed"?"Permiso de micrófono denegado":"Error de dictado: "+e.error)};rec.onend=()=>{finalText=sessionFinal;paint(finalText);listening=false;setMicState(false);$("hint").textContent="Dictado terminado. Puedes continuar o pulsar Enviar cuando acabes.";if(shortcutCapture&&finalText){shortcutCapture=false;createShortcut(finalText);$("text").value="";finalText=""}if(!draftId)autosize()};try{rec.start()}catch(e){listening=false;setMicState(false);ui.notify("No se pudo iniciar el dictado")}}
function readImages(files,msg){pendingImages=files;ui.showImagePreview(files);ui.notify(msg)}

$("mic").onclick=start;$("micMini").onclick=start;
$("clear").onclick=()=>{$("text").value="";finalText="";autosize();ui.notify("Borrador limpiado")};
$("contactsConnect").onclick=google.connectContacts;
$("contactsDisconnect").onclick=google.disconnectContacts;
$("calendarConnect").onclick=google.connectCalendar;
$("calendarDisconnect").onclick=google.disconnectCalendar;
$("driveConnect").onclick=google.connectDrive;
$("driveDisconnect").onclick=google.disconnectDrive;
$("aiConnect").onclick=cloud.connect;
$("aiDisconnect").onclick=cloud.disconnect;
$("resetData").onclick=async()=>{if(!confirm("Se borrará únicamente la caché temporal de este dispositivo. Tus entradas y adjuntos seguirán en Angeli y se volverán a cargar. ¿Continuar?"))return;try{await deleteMediaDB();clearNotes();clearPendingMedia();$("text").value="";ui.notify("Caché local eliminada; tus datos siguen en Angeli")}catch(e){ui.notify("No se pudo eliminar toda la caché local")}};
$("add").onclick=add;
$("headerSend").onclick=add;
$("text").oninput=()=>{autosize();ui.updateDraft($("text").value)};
$("text").onfocus=()=>{if(!$("actionModal").classList.contains("show"))setTimeout(()=>{if(!$("actionModal").classList.contains("show"))openDraft()},120)};
$("text").onkeydown=event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();add()}};
$("attachToggle").onclick=()=>$("attachmentChoices").classList.toggle("show");
$("searchToggle").onclick=()=>$("searchPanel").classList.toggle("show");
$("menuOpen").onclick=ui.openMenu;$("menuClose").onclick=ui.closeLayers;$("scrim").onclick=()=>{if(!$("actionModal").classList.contains("conversation-modal"))ui.closeLayers()};
$("clearView").onclick=()=>{if(confirm("Esto limpia solo la conversación visible. Tus entradas, fotos y archivos seguirán guardados. ¿Continuar?")){$("list").innerHTML='<div class="empty">Vista limpia. Tus datos siguen guardados.</div>';ui.notify("Vista limpiada")}};
$("shortcutManual").onclick=()=>createShortcut();
$("shortcutVoice").onclick=()=>{shortcutCapture=true;$("text").value="";$("text").placeholder="Di la orden que ejecutará el acceso directo…";ui.closeLayers();start()};
$("shortcutEdit").onclick=editShortcuts;
$("cameraInput").onchange=e=>{if(e.target.files.length)readImages([...e.target.files],"Foto preparada")};
$("photoInput").onchange=e=>{if(e.target.files.length)readImages([...e.target.files],"Imagen seleccionada")};
$("fileInput").onchange=e=>{pendingFiles=[...e.target.files];if(pendingFiles.length)ui.notify("Archivo preparado")};
$("search").oninput=render;
$("typeFilter").onchange=e=>{selectedType=e.target.value;render()};
document.querySelectorAll(".filter").forEach(button=>button.onclick=()=>{selectedFilter=button.dataset.filter;document.querySelectorAll(".filter").forEach(item=>item.classList.toggle("active",item===button));render()});
$("shortcuts").onclick=event=>{const button=event.target.closest("button");if(!button)return;if(button.id==="shortcutAdd"){createShortcut();return}const shortcut=shortcuts[Number(button.dataset.shortcut)];if(shortcut)prepareShortcut(shortcut)};
function completeCurrentAction(id){
 const current=notes.find(item=>item.id===id);
 if(current?.interaction?.status==="pending_confirmation")save(notes.map(item=>item.id===id?completeInteraction(item):item));
 return notes.find(item=>item.id===id)||current;
}
const cancelAgendaEvent=createAgendaActions({google,
 onDeleted:eventId=>saveConfirmed(markCancelledReminder(notes,eventId)),
 showList:note=>ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google),
 showWorking:()=>ui.showWorking("Actualizando agenda","Angeli está revisando los eventos que quedan…","")
});
async function handleEntryAction(event){
 const button=event.target.closest("button");if(!button)return;
 const note=notes.find(item=>item.id===button.dataset.id);if(!note)return;
 const action=button.dataset.a;
 if(action==="edit-calendar-field"){
  const field=button.dataset.field;
  ui.showCalendarFieldEditor(note,field,{onMic:draftId=>start({inConversation:true,draftId}),onCancel:()=>ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google),onSave:async value=>{const next=updateCalendarDetails(note,field,value);if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});
  return;
 }
 if(action==="defer-call-reminder"||action==="defer-call-calendar"){
  const intent=action==="defer-call-calendar"?"calendar.create":"reminder.create";
  const turn=resolveConversationTurn({active:{...note,interaction:{...note.interaction,status:"completed"}},text:button.textContent,interpretation:deferredCallIntent(note,intent)});
  const proposal=planIntent(turn.interpretation),next={...note,type:entryTypeForIntent(proposal),aiIntent:turn.interpretation,proposal,interaction:turn.interaction};
  if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))continueConversation(next);
  return;
 }
 if(action==="agenda-view"){ui.showCalendarEvent(note,google,button.dataset.eventId);return}
 if(action==="agenda-delete"){await cancelAgendaEvent(note,button.dataset.eventId);return}
 if(action==="show-action"){ui.showEntryAction(note,google);return}
 if(action==="schedule"){
  ui.showWorking("Programando aviso","Angeli está creando el aviso en Calendar…","");
  await google.createScheduledReminder(note);
  const current=notes.find(item=>item.id===note.id)||note;
  if(current.schedule?.status==="scheduled")completeCurrentAction(note.id);
  ui.showEntryAction(notes.find(item=>item.id===note.id)||current,google);return;
 }
 if(action==="cancel-schedule"){
  await google.cancelScheduledReminder(note);
  const current=notes.find(item=>item.id===note.id)||note;
  if(current.schedule?.status==="cancelled")await cancelActive(current);
  ui.showEntryAction(notes.find(item=>item.id===note.id)||current,google);return;
 }
 if(action==="calendar"){
  ui.showWorking("Añadiendo al calendario","Angeli está creando el evento…","");
  await google.createCalendarEvent(note,{confirmed:true});
  const current=notes.find(item=>item.id===note.id)||note;
  if(current.calendarStatus==="synced")completeCurrentAction(note.id);
  ui.showEntryAction(notes.find(item=>item.id===note.id)||current,google);return;
 }
 if(action==="search-calendar"){
  ui.showWorking("Buscando en Calendar","Angeli está revisando tus eventos…","");
  await google.searchCalendar(note);ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google);return;
 }
 if(action==="search-calendar-date"){
  const date=$("cancelSearchDate")?.value;
  if(!date){ui.notify("Elige la fecha en la que quieres buscar");return}
  const next={...note,aiIntent:{...note.aiIntent,rangeStart:null,rangeEnd:null,target:{...note.aiIntent.target,date}}};
  await saveConfirmed(notes.map(item=>item.id===note.id?next:item));
  ui.showWorking("Buscando en Calendar","Angeli está revisando la fecha indicada…","");
  await google.searchCalendar(next);ui.showEntryAction(next,google);return;
 }
 if(action==="calendar-delete"||action==="calendar-update"){
  if(action==="calendar-delete")await google.deleteCalendarEvent(note,button.dataset.eventId);else await google.updateCalendarEvent(note,button.dataset.eventId);
  const current=notes.find(item=>item.id===note.id)||note;
  if(current.proposal?.actionStatus==="completed"){
   if(action==="calendar-delete")await saveConfirmed(markCancelledReminder(notes,button.dataset.eventId));
   completeCurrentAction(note.id);
  }
  ui.showEntryAction(notes.find(item=>item.id===note.id)||current,google);return;
 }
 if(action==="call"){completeCurrentAction(note.id);ui.closeLayers();window.location.href=`tel:${button.dataset.phone}`;return}
 if(action==="search-contact"){
  ui.showWorking("Buscando contacto","Angeli está buscando a "+(note.contactQuery||"ese contacto")+"…","");
  await google.searchContact(note);ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google);return;
 }
 if(action==="open-file"){
  try{const media=await mediaServiceGet(button.dataset.mediaId);if(!media)throw new Error();const url=URL.createObjectURL(media.blob);window.open(url,"_blank");setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){ui.notify("No se pudo abrir el archivo")};return;
 }
 if(action==="toggle"){save(notes.map(item=>item.id===note.id?{...item,status:item.status==="done"?"pending":"done"}:item));return}
 if(action==="delete"){
  if(!save(notes.filter(item=>item.id!==note.id)))return;google.clearContactResult(note.id);
  try{for(const image of note.images||[])await media.remove(typeof image==="string"?image:image.driveFileId||image.id);for(const file of note.files||[])if(file.id||file.driveFileId)await media.remove(file.driveFileId||file.id)}catch(e){ui.notify("La entrada se borró, pero quedó algún adjunto en Drive")}
 }
}
$("list").onclick=handleEntryAction;$("actionModal").onclick=handleEntryAction;
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=0.21.25",{updateViaCache:"none"}).then(registration=>registration.update()).catch(()=>{});
load();

async function mediaServiceGet(id){return media.getMedia(id)}
function esc(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]))}
