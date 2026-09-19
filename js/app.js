import{clearNotes,deleteMediaDB,readShortcuts,writeShortcuts}from"./storage.js?v=0.21.82";
import{classify,actionData}from"./classifier.js?v=0.21.82";
import{sendEntry}from"./sheets.js?v=0.21.82";
import{createUI}from"./ui.js?v=0.21.82";
import{createGoogleIntegration}from"./google.js?v=0.21.82";
import{interpret,remoteProvider,chatAside,searchMercadonaProduct,localReminderQuery,localNoteQuery,localCalendarCancellation,localCalendarUpdate,localLinkedCalendarIntent,localImmediateCall,protectCalendarInterpretation,protectContactCallInterpretation,protectReadQuery}from"./ai.js?v=0.21.82";
import{parseShoppingCommand,parseItemList,addShoppingItems,removeShoppingItems,checkShoppingItems,clearShoppingList,toggleShoppingItem,removeShoppingItemById,setShoppingItemProduct,setShoppingItemQuantity,describeShoppingItems}from"./shopping.js?v=0.21.82";
import{entryTypeForIntent,planIntent}from"./intents.js?v=0.21.82";
import{calendarQueryRange,temporalData}from"./temporal.js?v=0.21.82";
import{normalizeFutureCall,normalizeReminderSchedule,normalizeUndatedCall,deferredCallIntent,scheduleFor,linkedScheduleFor,updateCalendarDetails,updateCalendarDateTime}from"./schedule.js?v=0.21.82";
import{createCloudSync}from"./firebase.js?v=0.21.82";
import{createMediaService}from"./media.js?v=0.21.82";
import{cancelInteraction,completeInteraction,contextFor,resolveConversationTurn,preserveCancellation}from"./conversation.js?v=0.21.82";
import{completionTarget,completePendingWithCalendar,findPendingMatches,findReminderMatches,markCancelledReminder}from"./pending.js?v=0.21.82";
import{createAgendaActions}from"./agenda.js?v=0.21.82";
import{prepareNoteDraft,missingNoteDraftFields,findNoteMatches,noteClassificationFromIntent,removeNoteEntry,updateNoteDraft,updateNoteStatus}from"./notes.js?v=0.21.82";
import{DEFAULT_NOTE_SETTINGS,addNoteSetting,applyExplicitNoteCategory,normalizeNoteSettings,noteInterpretationContext,removeNoteSetting,renameNoteSetting,settingLabel}from"./note-settings.js?v=0.21.82";
import{DEFAULT_SHORTCUTS,normalizeShortcuts,routeShortcutIntent,shortcutPrefix,shortcutType}from"./shortcuts.js?v=0.21.82";
import{localWhatsApp,whatsappUrl}from"./whatsapp.js?v=0.21.82";
import{DEFAULT_NOTIFICATION_SETTINGS,normalizeNotificationSettings}from"./notification-settings.js?v=0.21.82";
import{mediaLibraryItems}from"./media-library.js?v=0.21.82";
import{mediaContextComplete,normalizeMediaContext}from"./media-context.js?v=0.21.82";

let media;const ui=createUI({getMedia:(_,id)=>media.getMedia(id)});const $=ui.$;
let notes=[],rec=null,listening=false,finalText="",pendingImages=[],pendingFiles=[],pendingMediaContext=null,selectedFilter="all",selectedType="all",shortcutCapture=false,pendingShortcut=null,saving=false,noteDraftSaving=false;
let lastConnectionCheck=0;
let noteSettings=normalizeNoteSettings(DEFAULT_NOTE_SETTINGS);
let notificationSettings=normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
let libraryState={kind:"all",category:"all",query:""};
let noteLibraryState={status:"pending",category:"all",query:""};
let dietarioState={range:"week",type:"all"};
let shoppingList=[];
let shortcuts=normalizeShortcuts(readShortcuts()||DEFAULT_SHORTCUTS);
// Los avisos push llegan con "?reminder=<id>" (backend/push_notifications.py),
// pero hasta ahora nadie leía ese parámetro: tocar la notificación abría la
// app en la pantalla de siempre sin llevar a la entrada que la originó.
let pendingReminderFocus=new URLSearchParams(location.search).get("reminder")||null;
function render(){ui.render({notes,selectedFilter,selectedType,google,noteSettings});focusPendingReminder()}
function focusPendingReminder(){
 if(!pendingReminderFocus)return;
 const target=notes.find(item=>item.id===pendingReminderFocus);
 if(!target)return;
 if(selectedFilter!=="all"||selectedType!=="all"||$("search").value){
  selectedFilter="all";selectedType="all";$("search").value="";
  document.querySelectorAll(".filter").forEach(item=>item.classList.toggle("active",item.dataset.filter==="all"));
  $("typeFilter").value="all";
  render();
  return;
 }
 const id=pendingReminderFocus;pendingReminderFocus=null;
 history.replaceState(null,"",location.pathname);
 requestAnimationFrame(()=>{
  const article=document.querySelector('[data-entry-id="'+CSS.escape(id)+'"]');
  if(!article)return;
  article.scrollIntoView({behavior:"smooth",block:"center"});
  article.classList.add("entry-highlight");
  setTimeout(()=>article.classList.remove("entry-highlight"),2600);
 });
}
function autosize(){const text=$("text");text.style.height="auto";text.style.height=Math.min(text.scrollHeight,78)+"px"}
function renderShortcuts(){$("shortcuts").innerHTML=shortcuts.map((shortcut,index)=>`<button class="shortcut" data-shortcut="${index}">${esc(shortcut.label)}</button>`).join("")+`<button class="shortcut add" id="shortcutAdd" aria-label="Crear acceso directo">＋</button>`}
function saveShortcuts(){shortcuts=normalizeShortcuts(shortcuts);writeShortcuts(shortcuts);renderShortcuts()}
function prepareShortcut(shortcut){pendingShortcut=shortcut;if(shortcut.command){$("text").value=shortcut.command;autosize();add({shortcut});return}const prefix=shortcutPrefix(shortcut);$("text").value=prefix;$("text").placeholder=shortcut.prompt||"Escribe o dicta tu instrucción…";autosize();openDraft();if(shortcut.dictate||shortcut.action==="contact.call")setTimeout(start,120);else ui.notify(shortcut.prompt||"Completa la instrucción y pulsa Enviar")}
function createShortcut(initial=""){const command=prompt("Escribe la orden que ejecutará Angeli.",initial);if(!command?.trim())return;const label=prompt("Nombre corto para el acceso directo.",command.trim().slice(0,24));if(!label?.trim())return;shortcuts.push({label:label.trim(),command:command.trim()});saveShortcuts();ui.notify("Acceso directo creado")}
function editShortcuts(){if(!shortcuts.length){ui.notify("No hay accesos para editar");return}const choices=shortcuts.map((shortcut,index)=>`${index+1}. ${shortcut.label}`).join("\n"),value=prompt(`Indica el número del acceso que quieres eliminar:\n${choices}`);const index=Number(value)-1;if(!Number.isInteger(index)||!shortcuts[index])return;shortcuts.splice(index,1);saveShortcuts();ui.notify("Acceso directo eliminado")}
function scrollConversation(){requestAnimationFrame(()=>$("mainContent").scrollTo({top:$("mainContent").scrollHeight,behavior:"smooth"}))}
function setSending(active){$("add").disabled=active}
function clearPendingMedia(){pendingImages=[];pendingFiles=[];pendingMediaContext=null;$("cameraInput").value="";$("photoInput").value="";$("fileInput").value="";$("preview").innerHTML="";}
function describePendingMedia(){return [...pendingImages,...pendingFiles].map(file=>file.name).filter(Boolean)}
function askMediaContext(){
 ui.showMediaContextEditor({files:describePendingMedia(),context:pendingMediaContext,settings:noteSettings,onCancel:clearPendingMedia,onSave:values=>{pendingMediaContext=normalizeMediaContext(values,noteSettings);ui.closeLayers();ui.notify("Adjunto clasificado. Puedes añadir una instrucción o enviarlo.")}})
}
function prepareMedia(files,kind,message){if(kind==="image")pendingImages=files;else pendingFiles=files;ui.showImagePreview(pendingImages);$("attachmentChoices").classList.remove("show");ui.notify(message);askMediaContext()}
async function saveConfirmed(nextNotes,previousNotes=notes,{waitForServer=false}={}){if(!cloud.isSignedIn()){ui.notify("Inicia sesión en Angeli antes de guardar");return false}notes=nextNotes;render();ui.setSyncStatus({state:"pending"});const syncing=cloud.syncNotes(nextNotes,previousNotes);if(waitForServer){try{await syncing;return true}catch(error){ui.setSyncStatus({state:"error",error});ui.notify("La instrucción sigue pendiente de sincronizar. Revisa Datos en Ajustes.");return false}}void syncing.catch(error=>{ui.setSyncStatus({state:"error",error});ui.notify("La instrucción sigue pendiente de sincronizar. Revisa Datos en Ajustes.")});return true}
function save(nextNotes,previousNotes=notes){void saveConfirmed(nextNotes,previousNotes);return true}
const cloud=createCloudSync({notify:ui.notify});
const google=createGoogleIntegration({notify:ui.notify,refresh:render,setStatus:ui.setGoogleStatus,showConnectionHealth:problems=>ui.showConnectionHealth(problems,{onOpenSettings:ui.openMenu}),saveNotes:save,getNotes:()=>notes,getAuthToken:cloud.getAuthToken,getSession:cloud.session,scheduleNotification:cloud.schedulePush,cancelNotification:cloud.cancelPush});
media=createMediaService({getAuthToken:cloud.getAuthToken,ensureDrive:google.ensureDrive});
function openDraft(){ui.showDraft({value:$("text").value,onInput:value=>{$("text").value=value;finalText=value;autosize()},onSend:add,onMic:()=>start({inConversation:true}),onCancel:()=>{pendingShortcut=null;ui.closeLayers()}})}
// Una interacción solo puede continuar desde su propio popup. El compositor
// principal inicia siempre una instrucción nueva: una pregunta anterior no
// puede secuestrar órdenes posteriores como «llama a Montse».
function continueConversation(entry){ui.showInteractionQuestion(entry,{onSend:value=>{$("text").value=value;finalText=value;autosize();add({interactionId:entry.id})},onMic:()=>start({inConversation:true}),onCancel:()=>cancelActive(entry)})}
async function discardNoteDraft(entry){
 ui.closeLayers();
 await Promise.allSettled([...(entry.images||[]),...(entry.files||[])].map(item=>media.remove(item.driveFileId||item.id)));
 ui.notify("Nota descartada");
}
function stageNoteDraft(entry,values){const updated=updateNoteDraft(entry,values),pendingImages=[...(values.images||[])],pendingFiles=[...(values.files||[])],hasMedia=Boolean((entry.images||[]).length||(entry.files||[]).length||pendingImages.length||pendingFiles.length);return{...updated,...(hasMedia?{mediaContext:normalizeMediaContext({purpose:values.purpose||values.text,scope:values.scope,relationType:values.relationType,relationName:values.relationName},noteSettings)}:{}),_pendingImages:pendingImages,_pendingFiles:pendingFiles}}
async function uploadNoteAttachments(entry){
 const pendingImages=entry._pendingImages||[],pendingFiles=entry._pendingFiles||[],uploaded=[];
 const {_pendingImages,_pendingFiles,...clean}=entry;
 try{
  for(const file of pendingImages)uploaded.push(await media.upload(file,"image",entry.id));
  const imageCount=uploaded.length;
  for(const file of pendingFiles)uploaded.push(await media.upload(file,"file",entry.id));
  return{...clean,images:[...(entry.images||[]),...uploaded.slice(0,imageCount)],files:[...(entry.files||[]),...uploaded.slice(imageCount)],updatedAt:new Date().toISOString()}
 }catch(error){await Promise.allSettled(uploaded.map(item=>media.remove(item.driveFileId||item.id)));throw error}
}
function reviewNoteDraft(entry){
 const missing=missingNoteDraftFields(entry);
 if(missing.length){
  ui.showNoteEditor(entry,{settings:noteSettings,missingFields:missing,onCancel:()=>discardNoteDraft(entry),onSave:values=>reviewNoteDraft(stageNoteDraft(entry,values))});
  return;
 }
 ui.showNoteConfirmation(entry,{
  settings:noteSettings,
  onCancel:()=>discardNoteDraft(entry),
  onEdit:()=>ui.showNoteEditor(entry,{settings:noteSettings,onCancel:()=>reviewNoteDraft(entry),onSave:values=>reviewNoteDraft(stageNoteDraft(entry,values))}),
  onSave:async()=>{
   if(noteDraftSaving)return;
   noteDraftSaving=true;
   try{
    entry=completeInteraction(await uploadNoteAttachments(entry));
    ui.showWorking("Guardando nota","Angeli está sincronizando la nota…","");
    if(!await saveConfirmed([entry,...notes])){ui.closeLayers();return}
    try{await sendEntry(entry,new Date());ui.notify("Nota registrada en Google")}catch(_){ui.notify("Nota sincronizada · Google Sheets no respondió")}
    ui.showEntryAction(entry,google);
   }catch(error){ui.notify(error.message||"No se pudieron subir los adjuntos");reviewNoteDraft(entry)}finally{noteDraftSaving=false}
  }
 });
}
async function saveNoteSettings(nextSettings,nextNotes=notes){
 const normalized=normalizeNoteSettings(nextSettings),previousNotes=notes;
 noteSettings=normalized;notes=nextNotes;render();
 try{await Promise.all([cloud.saveNoteSettings(normalized),nextNotes===previousNotes?Promise.resolve():cloud.syncNotes(nextNotes,previousNotes)]);ui.notify("Ajustes de notas guardados");return true}catch(error){ui.notify("No se pudieron guardar los ajustes de notas");return false}
}
function notesUsingSetting(key,id){return notes.filter(note=>(note.type==="note"&&(key==="categories"?note.noteClassification?.scope:note.noteClassification?.relationType)===id)||(key==="categories"?note.mediaContext?.scope:note.mediaContext?.relationType)===id)}
function showNoteSettings(){
 ui.showNoteSettings(noteSettings,{
  onAddCategory:()=>{const label=prompt("Nombre de la nueva categoría");if(label?.trim())saveNoteSettings(addNoteSetting(noteSettings,"categories",label)).then(showNoteSettings)},
  onAddRelation:()=>{const label=prompt("Nombre del nuevo tipo de relación");if(label?.trim())saveNoteSettings(addNoteSetting(noteSettings,"relationTypes",label)).then(showNoteSettings)},
  onAction:async(action,key,id)=>{
   const currentLabel=settingLabel(noteSettings,key,id),used=notesUsingSetting(key,id);
   if(action==="rename"){
    const label=prompt("Nuevo nombre",currentLabel);if(!label?.trim())return;
    const nextSettings=renameNoteSetting(noteSettings,key,id,label);
    const nextNotes=notes.map(note=>{const classification=note.noteClassification||{},context=note.mediaContext||{};let next=note;if(note.type==="note"&&key==="categories"&&classification.scope===id)next={...next,noteClassification:{...classification,categoryLabel:label.trim()}};if(note.type==="note"&&key==="relationTypes"&&classification.relationType===id)next={...next,noteClassification:{...classification,relationTypeLabel:label.trim()}};if(key==="categories"&&context.scope===id)next={...next,mediaContext:{...context,categoryLabel:label.trim()}};if(key==="relationTypes"&&context.relationType===id)next={...next,mediaContext:{...context,relationTypeLabel:label.trim()}};return next});
    await saveNoteSettings(nextSettings,nextNotes);showNoteSettings();return;
   }
   if(action==="delete"){
    if(key==="categories"&&noteSettings.categories.length===1){ui.notify("Debe quedar al menos una categoría");return}
    if(used.length&&!confirm(`${currentLabel} se usa en ${used.length} nota${used.length===1?"":"s"}. ¿Quieres eliminarla y reasignar esas notas?`))return;
    const nextSettings=removeNoteSetting(noteSettings,key,id),fallback=nextSettings.categories[0];
    const nextNotes=notes.map(note=>{const classification=note.noteClassification||{},context=note.mediaContext||{};let next=note;if(note.type==="note"&&key==="categories"&&classification.scope===id)next={...next,noteClassification:{...classification,scope:fallback.id,categoryLabel:fallback.label}};if(note.type==="note"&&key==="relationTypes"&&classification.relationType===id)next={...next,noteClassification:{...classification,relationType:"none",relationTypeLabel:"",relationName:null}};if(key==="categories"&&context.scope===id)next={...next,mediaContext:{...context,scope:fallback.id,categoryLabel:fallback.label}};if(key==="relationTypes"&&context.relationType===id)next={...next,mediaContext:{...context,relationType:"none",relationTypeLabel:"",relationName:""}};return next});
    await saveNoteSettings(nextSettings,nextNotes);showNoteSettings();
   }
  }
 });
}
async function verifyConnections(announce=true){lastConnectionCheck=Date.now();await google.syncLinks({announce});render()}
async function load(){notes=[];renderShortcuts();google.updateStatus();ui.setPushStatus(cloud.pushStatus());ui.setSyncStatus({state:"connecting"});render();await cloud.initialize({onRemoteNotes:remote=>{notes=remote;render()},onNoteSettings:remote=>{noteSettings=normalizeNoteSettings(remote||DEFAULT_NOTE_SETTINGS);render()},onNotificationSettings:remote=>{notificationSettings=normalizeNotificationSettings(remote||DEFAULT_NOTIFICATION_SETTINGS)},onNoteSettingsError:()=>ui.notify("No se pudieron cargar los ajustes de notas"),onNotificationSettingsError:()=>ui.notify("No se pudieron cargar los ajustes de avisos"),onShoppingList:remote=>{shoppingList=remote;if($("shoppingLibrary").classList.contains("show"))ui.renderShoppingList(shoppingList)},onShoppingListError:()=>ui.notify("No se pudo cargar la lista de la compra"),onSyncStatus:ui.setSyncStatus,onPushStatus:ui.setPushStatus,onAuthChange:async()=>{google.updateStatus();ui.setPushStatus(cloud.pushStatus());await verifyConnections(true)}});render();ui.dismissWelcome()}
async function add({interactionId=null,shortcut=null}={}){
 if(saving)return;
 const shortcutContext=shortcut||pendingShortcut,text=$("text").value.trim(),active=interactionId?notes.find(item=>item.id===interactionId&&item.interaction?.status==="awaiting_input")||null:null;
 // La lista de la compra es una función nueva y separada de las notas — no
 // es una entrada más de la conversación, es una lista propia que se puede
 // ir marcando. Se resuelve aquí, antes de tocar nada del intérprete/notas,
 // para no arriesgar el resto del pipeline ("no romper lo que ya tenemos").
 // No se exige "!active": si hay una pregunta pendiente sin resolver de
 // otra instrucción (nota/recordatorio a medias), un comando inequívoco de
 // la lista de la compra debe reconocerse igual, no absorberse en silencio
 // como si fuera la respuesta a esa otra pregunta. Reportado en real: desde
 // el modo conversación, "añade colacao a la lista de la compra" se coló
 // como respuesta a una nota pendiente sin relación, y acabó pidiendo un
 // título de nota en vez de añadir el artículo.
 if(!shortcutContext&&!pendingImages.length&&!pendingFiles.length){
  const shoppingCommand=parseShoppingCommand(text);
  // Reportado: al dictar desde el botón normal, openDraft() ya había abierto
  // el modal antes de llegar aquí; si no se cierra, se queda fijo en pantalla
  // aunque la orden se procese bien (el aviso de "añadido" es un toast, no
  // sustituye el contenido del modal como sí hace showEntryAction para una nota).
  if(shoppingCommand){clearComposer();ui.closeLayers();if(shoppingCommand.action==="search")runShoppingSearchCommand(shoppingCommand);else await runShoppingCommand(shoppingCommand);return}
 }
 if(!text&&!pendingImages.length&&!pendingFiles.length){ui.notify("No hay nada que enviar");return}
 if((pendingImages.length||pendingFiles.length)&&!mediaContextComplete(pendingMediaContext)){askMediaContext();return}
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
   const fallbackType=active?.type||shortcutType(shortcutContext)||classify(text,images,files);
   const localLinked=localLinkedCalendarIntent(text,now);
   const whatsApp=localWhatsApp(text,active);
   const noteQuery=(localLinked||whatsApp||shortcutContext?.action)?null:localNoteQuery(text);
   const reminderQuery=(localLinked||shortcutContext?.action)?null:localReminderQuery(text);
   const cancellation=(localLinked||noteQuery||reminderQuery||(shortcutContext?.action&&shortcutContext.action!=="calendar.delete"))?null:localCalendarCancellation(text);
   const localUpdate=(localLinked||noteQuery||reminderQuery||shortcutContext?.action)?null:localCalendarUpdate(text,now,active);
   const immediateCall=(localLinked||whatsApp||noteQuery||reminderQuery||cancellation||localUpdate||shortcutContext?.action)?null:localImmediateCall(text,now);
   const interpreted=await interpret(text,{provider:(value,context)=>google.interpretWithAI(value,remoteProvider,context),fallback:()=>localLinked||whatsApp||noteQuery||reminderQuery||cancellation||localUpdate||localInterpretation(text,fallbackType,active),context:noteInterpretationContext(contextFor(active),noteSettings)});
   const aiWhatsApp=interpreted.intent==="whatsapp.compose";
   const whatsAppInterpretation=whatsApp?{...interpreted,intent:"whatsapp.compose",contactName:(aiWhatsApp?interpreted.contactName:null)||whatsApp.contactName||null,phone:(aiWhatsApp?interpreted.phone:null)||whatsApp.phone||null,notes:(aiWhatsApp?interpreted.notes:null)||whatsApp.notes||null,requiresConfirmation:true,missingFields:[],question:null}:interpreted;
   const rawInterpretation=applyExplicitNoteCategory(routeShortcutIntent(whatsAppInterpretation,shortcutContext,text,now),text,noteSettings);
   if(rawInterpretation.source==="fallback")ui.updateWorking("Estoy revisando tu petición","Necesito confirmarla contigo antes de continuar.","");
   const deterministic=localLinked||cancellation||localUpdate;
   const routedInterpretation=(noteQuery||reminderQuery)?protectReadQuery(rawInterpretation,noteQuery,reminderQuery):protectContactCallInterpretation(preserveCancellation(active,protectCalendarInterpretation(rawInterpretation,deterministic)),immediateCall);
   const normalizedInterpretation=normalizeReminderSchedule(normalizeFutureCall(normalizeUndatedCall(routedInterpretation,text,active,now),text),text,now);
   if(normalizedInterpretation.intent==="task.complete"){await resolvePendingCompletion(normalizedInterpretation);return}
   if(normalizedInterpretation.intent==="reminder.query"){await resolveReminderQuery(normalizedInterpretation);return}
   if(normalizedInterpretation.intent==="note.query"){resolveNoteQuery(normalizedInterpretation);return}
   const turn=resolveConversationTurn({active,text,interpretation:normalizedInterpretation,now:now.toISOString()});
   const interpretation=turn.interpretation,proposal=planIntent(interpretation,fallbackType),type=entryTypeForIntent(proposal,fallbackType);
   const data={...(interpretation.date?{scheduledDate:interpretation.date}:{}),...(interpretation.time?{scheduledTime:interpretation.time}:{}),...(interpretation.phone?{phone:interpretation.phone}:{}),...(interpretation.location?{location:interpretation.location}:{}),...(type==="calendar"&&interpretation.title?{calendarTitle:interpretation.title}:{}),...(type==="contact"&&interpretation.contactName?{contactQuery:interpretation.contactName}:{}),...(type==="note"?{noteClassification:noteClassificationFromIntent(interpretation)}:{})};
   const schedule=scheduleFor(interpretation,active?.text||text)||linkedScheduleFor(interpretation);
   const entry={...(active||{}),id,date:active?.date||now.toISOString(),updatedAt:now.toISOString(),text:active?.text||text||pendingMediaContext?.purpose||"",status:active?.status||"pending",type,...data,aiIntent:interpretation,proposal,interaction:turn.interaction,...(proposal.intent==="calendar.create"?{calendarStatus:active?.calendarStatus||"pending"}:{}),...(schedule?{schedule}:{}),...(hasMedia?{mediaContext:pendingMediaContext}:{}),images:[...(active?.images||[]),...images],files:[...(active?.files||[]),...files]};
   if(!active&&proposal.intent==="note"){
     clearComposer();
     reviewNoteDraft(prepareNoteDraft(entry,noteSettings));
     return;
   }
   ui.updateWorking("Guardando","Angeli está registrando tu instrucción…","");
   const previousNotes=notes,nextNotes=active?notes.map(item=>item.id===active.id?entry:item):[entry,...notes];
   const datedTask=entry.type==="task"&&entry.status==="pending"&&entry.scheduledDate&&entry.scheduledTime;
   if(!await saveConfirmed(nextNotes,previousNotes,{waitForServer:datedTask})){if(hasMedia)await Promise.allSettled([...images,...files].map(item=>media.remove(item.driveFileId||item.id)));ui.closeLayers();return}
   if(datedTask){try{await cloud.schedulePush(entry)}catch(_){ui.notify("La tarea se guardó, pero su aviso necesita reintento")}}
   clearComposer();
   if(!active){try{await sendEntry(entry,now);ui.notify("Entrada registrada en Google")}catch(e){ui.notify("Entrada sincronizada · Google Sheets no respondió")}}
   if(entry.interaction.status==="awaiting_input")continueConversation(entry);
   else {
     if(interpretation.intent==="calendar.delete"||interpretation.intent==="calendar.update"||(shortcutContext?.direct&&interpretation.intent==="calendar.query")){
       const searchMessage=interpretation.intent==="calendar.delete"?"Angeli está buscando los eventos que quieres cancelar…":interpretation.intent==="calendar.update"?"Angeli está buscando el evento que quieres modificar…":"Angeli está consultando tu agenda…";
       ui.updateWorking("Buscando en Calendar",searchMessage,"");
       await google.searchCalendar(entry);
     }
     if(shortcutContext?.direct&&interpretation.intent==="contact.call"){
       ui.updateWorking("Buscando contacto","Angeli está buscando a "+(entry.contactQuery||"ese contacto")+"…","");
       await google.searchContact(entry);
     }
     ui.showEntryAction(entry,google);
   }
 }catch(error){
   if(hasMedia&&!mediaUploaded){clearPendingMedia();ui.closeLayers();ui.notify(error.message||"No se pudo subir el adjunto. Se ha quitado de la petición; puedes volver a elegirlo e intentarlo.");return}
   if(mediaUploaded)await Promise.allSettled([...images,...files].map(item=>media.remove(item.driveFileId||item.id)));
   ui.closeLayers();ui.notify(error.message||"No se pudo guardar la entrada");
 }finally{saving=false;setSending(false)}
}
function clearComposer(){$("text").value="";$("text").placeholder="Escribe o dicta tu instrucción…";autosize();finalText="";pendingShortcut=null;clearPendingMedia()}
async function finishPending(entry){try{const completed=await completePendingWithCalendar(entry,item=>google.completeScheduledReminder(item));if(!await saveConfirmed(notes.map(item=>item.id===entry.id?completed:item)))return;clearComposer();ui.showCompletion({title:"✓ Pendiente completado",lead:`He marcado como hecho: ${entry.aiIntent?.title||entry.text}`})}catch(_){clearComposer();ui.showCompletion({title:"No he podido completar el pendiente",lead:"El aviso sigue activo en Calendar. Inténtalo de nuevo."})}}
async function resolvePendingCompletion(interpretation){const matches=findPendingMatches(notes,interpretation);clearComposer();if(!matches.length){ui.showCompletion({title:"No encuentro ese pendiente",lead:"No he creado ninguna entrada nueva."});return}if(matches.length===1){await finishPending(matches[0]);return}ui.showPendingChoices(matches,{onSelect:finishPending,onCancel:ui.closeLayers})}
function resolveNoteQuery(interpretation){clearComposer();showNoteQueryResults(interpretation)}
function showNoteQueryResults(interpretation){
 const matches=findNoteMatches(notes,interpretation),query=interpretation.noteQuery||"";
 const reopen=()=>showNoteQueryResults(interpretation);
 const edit=entry=>ui.showNoteEditor(entry,{settings:noteSettings,onCancel:()=>showNoteDetail(entry,interpretation),onSave:async values=>{const updated=updateNoteDraft(entry,values);if(await saveConfirmed(notes.map(item=>item.id===entry.id?updated:item)))showNoteDetail(updated,interpretation)}});
 const toggle=async entry=>{const updated=updateNoteStatus(entry,entry.status==="done"?"pending":"done");if(await saveConfirmed(notes.map(item=>item.id===entry.id?updated:item))){ui.notify(updated.status==="done"?"Nota marcada como hecha":"Nota reabierta");showNoteDetail(updated,interpretation)}};
 const remove=entry=>ui.showNoteDeleteConfirmation(entry,{onCancel:()=>showNoteDetail(entry,interpretation),onConfirm:async()=>{if(!await saveConfirmed(removeNoteEntry(notes,entry.id)))return;try{for(const item of[...(entry.images||[]),...(entry.files||[])])await media.remove(typeof item==="string"?item:item.driveFileId||item.id)}catch(_){ui.notify("La nota se borró, pero quedó algún adjunto en Drive")}ui.notify("Nota borrada");reopen()}});
 const showNoteDetail=(entry)=>ui.showNoteDetail(entry,{onBack:reopen,onEdit:edit,onToggle:toggle,onDelete:remove});
 ui.showNoteResults(matches,query,{
  status:interpretation.noteStatus||"pending",
  onOpen:showNoteDetail,onEdit:edit,onToggle:toggle,onDelete:remove
 });
}
async function resolveReminderQuery(interpretation){
 clearComposer();
 try{
  const reconciled=await google.reconcileScheduledReminders(notes);
  if(reconciled.some((entry,index)=>entry!==notes[index]))await saveConfirmed(reconciled,notes);
 }catch(_){ui.notify("No he podido comprobar ahora los avisos con Calendar. Te muestro los datos de Angeli.")}
 const matches=findReminderMatches(notes,interpretation);
 const reopen=()=>resolveReminderQuery(interpretation);
 const showDetail=entry=>ui.showReminderDetail(entry,{onBack:reopen,onEdit:()=>ui.showReminderEditor(entry,{onCancel:()=>showDetail(entry),onSave:async values=>{let next=updateCalendarDetails(entry,"title",values.title);next=updateCalendarDetails(next,"location",values.location);next=updateCalendarDetails(next,"description",values.description);next=updateCalendarDateTime(next,values.date,values.time);ui.showWorking("Actualizando recordatorio","Guardando los cambios en Angeli y Calendar…","");if(await google.updateScheduledReminder(next)&&await saveConfirmed(notes.map(item=>item.id===entry.id?next:item)))showDetail(next);else showDetail(entry)}}),onComplete:finishPending,onCancel:()=>ui.showReminderCancellation(entry)});
 ui.showReminderResults(matches,interpretation.target?.title||"",{onSelect:showDetail})
}
async function cancelActive(entry){await saveConfirmed(notes.map(item=>item.id===entry.id?cancelInteraction(item):item));ui.closeLayers();ui.notify("Operación cancelada")}
function localInterpretation(text,type,active=null){const query=localReminderQuery(text);if(query&&!active)return query;const reminder=type==="reminder"&&!active,data={...actionData(text,type),...temporalData(text,new Date(),{inferDateFromTime:reminder})},isCompletion=/\b(?:ya\s+)?he\s+(?:llamado|terminado|completado|hecho)\b/i.test(text),isCalendarQuery=/\b(?:qué|que)\s+(?:tengo|hay)|\b(?:muéstrame|muestrame|consulta)\s+(?:mi\s+)?(?:agenda|calendario)\b/i.test(text),futureCall=type==="contact"&&Boolean(data.scheduledDate||data.scheduledTime),intent=isCompletion?"task.complete":isCalendarQuery?"calendar.query":futureCall?"reminder.create":{note:"note",task:"task.create",reminder:"reminder.create",calendar:"calendar.create",contact:"contact.call",file:"file.store",photo:"photo.store"}[type]||"note";return{intent,confidence:.5,title:text||null,date:data.scheduledDate||null,time:data.scheduledTime||null,...(isCalendarQuery?(calendarQueryRange(text)||{}):{}),location:null,contactName:data.contactQuery||null,phone:data.phone||null,notes:null,target:isCompletion?{title:completionTarget(text)||text,date:null,time:null}:null,changes:null,missingFields:[],question:null,requiresConfirmation:Boolean(data.scheduledDate&&data.scheduledTime)}}
function setMicState(active){$("mic").classList.toggle("listening",active);$("micMini").classList.toggle("listening",active);$("shoppingMic")?.classList.toggle("listening",active);document.querySelectorAll(".conversation-mic,.modal-actions .voice").forEach(button=>{button.classList.toggle("listening",active);button.textContent=active?"🎙️ Escuchando…":"🎙️ Hablar"});$("micLabel").textContent=active?"Escuchando… toca otra vez para parar":"Toca para hablar"}
function stop(){listening=false;if(rec){try{rec.stop()}catch(e){}}rec=null;setMicState(false);$("hint").textContent="Dictado terminado. Puedes continuar o pulsar Enviar cuando acabes.";autosize()}
function start({inConversation=false,draftId=null}={}){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){ui.notify("Este navegador no admite dictado");return}if(listening){stop();return}if(!inConversation)openDraft();const target=draftId?$(draftId):$("text");finalText=target?.value.trim()||"";rec=new SR();rec.lang="es-ES";rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=1;let sessionFinal=finalText||"",lastInterim="";const paint=value=>{if(target)target.value=value;if(!draftId){$("text").value=value;autosize()}ui.updateDraft(value)};rec.onstart=()=>{listening=true;setMicState(true);$("hint").textContent="Escuchando. Pulsa Enviar cuando la instrucción esté completa."};rec.onresult=e=>{let finalPart="",interimPart="";for(let i=e.resultIndex;i<e.results.length;i++){const result=e.results[i],phrase=(result[0]?.transcript||"").trim();if(!phrase)continue;if(result.isFinal)finalPart+=(finalPart?" ":"")+phrase;else interimPart+=(interimPart?" ":"")+phrase}if(finalPart){sessionFinal+=(sessionFinal?" ":"")+finalPart;lastInterim=""}else lastInterim=interimPart;finalText=sessionFinal;paint((sessionFinal+(lastInterim?" "+lastInterim:"")).trim())};rec.onerror=e=>{listening=false;setMicState(false);$("hint").textContent="Dictado detenido.";ui.notify(e.error==="not-allowed"?"Permiso de micrófono denegado":"Error de dictado: "+e.error)};rec.onend=()=>{finalText=sessionFinal;paint(finalText);listening=false;setMicState(false);$("hint").textContent="Dictado terminado. Puedes continuar o pulsar Enviar cuando acabes.";if(shortcutCapture&&finalText){shortcutCapture=false;createShortcut(finalText);$("text").value="";finalText=""}if(!draftId)autosize()};try{rec.start()}catch(e){listening=false;setMicState(false);ui.notify("No se pudo iniciar el dictado")}}
function readImages(files,msg){prepareMedia(files,"image",msg)}

function libraryItems(){return mediaLibraryItems(notes)}
function refreshLibrary(){ui.renderMediaLibrary(libraryItems(),libraryState)}
function libraryItem(key){return libraryItems().find(item=>item.key===key)}
function openLibrary(kind="all"){libraryState={kind,category:"all",query:""};$("librarySearch").value="";document.querySelectorAll("[data-library-kind]").forEach(button=>button.classList.toggle("active",button.dataset.libraryKind===kind));ui.openMediaLibrary(libraryItems(),libraryState)}
function reopenLibrary(){ui.openMediaLibrary(libraryItems(),libraryState)}
function openLibraryEntry(item){
 let entry=notes.find(note=>note.id===item.entryId);
 if(!entry)return;
 ui.closeMediaViewer();ui.closeMediaLibrary();
 const show=()=>ui.showMediaEntryDetail(entry,item,{
  onBack:()=>{ui.closeLayers();reopenLibrary()},
  onEdit:()=>ui.showMediaContextEditor({files:[item.name],context:entry.mediaContext,settings:noteSettings,onCancel:show,onSave:async values=>{const updated={...entry,mediaContext:normalizeMediaContext(values,noteSettings),updatedAt:new Date().toISOString()};if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){entry=updated;ui.notify("Clasificación guardada");show()}}}),
  onNote:()=>{
   if(entry.type==="note"){openNoteLibraryDetail(entry);return}
   const context=entry.mediaContext||{},draft=updateNoteDraft({...entry,type:"note",status:entry.status||"pending",aiIntent:{...(entry.aiIntent||{}),intent:"note",title:item.name,notes:context.purpose||entry.text||""}},{title:item.name,text:context.purpose||entry.text||"",scope:context.scope||"general",categoryLabel:context.categoryLabel,relationType:context.relationType||"none",relationTypeLabel:context.relationTypeLabel,relationName:context.relationName,purpose:context.purpose,tags:[]});
   ui.showNoteEditor(draft,{settings:noteSettings,onCancel:show,onSave:async values=>{try{const updated=await uploadNoteAttachments(stageNoteDraft(draft,values));if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){entry=updated;ui.notify("Nota añadida al adjunto");openNoteLibraryDetail(entry)}}catch(error){ui.notify(error.message||"No se pudieron subir los adjuntos")}}});
  }
 });
 show()
}
function noteLibraryItems(){return notes.filter(note=>note.type==="note")}
function refreshNoteLibrary(){ui.renderNoteLibrary(noteLibraryItems(),noteLibraryState)}
function openNoteLibrary(){noteLibraryState={status:"pending",category:"all",query:""};$("noteLibrarySearch").value="";document.querySelectorAll("[data-note-status]").forEach(button=>button.classList.toggle("active",button.dataset.noteStatus==="pending"));ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)}
function noteLibraryEntry(id){return notes.find(note=>note.id===id&&note.type==="note")}
function editNoteFromLibrary(entry,onCancel){ui.showNoteEditor(entry,{settings:noteSettings,onCancel,onSave:async values=>{try{const updated=await uploadNoteAttachments(stageNoteDraft(entry,values));if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){ui.notify("Nota y adjuntos actualizados");ui.closeLayers();refreshNoteLibrary()}}catch(error){ui.notify(error.message||"No se pudieron subir los adjuntos")}}})}
function openNoteLibraryDetail(entry){ui.closeNoteLibrary();const show=()=>ui.showNoteDetail(entry,{onBack:()=>{ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)},onEdit:()=>editNoteFromLibrary(entry,show),onToggle:async()=>{const updated=updateNoteStatus(entry,entry.status==="done"?"pending":"done");if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){entry=updated;ui.notify(updated.status==="done"?"Nota marcada como hecha":"Nota reabierta");show()}},onDelete:()=>ui.showNoteDeleteConfirmation(entry,{onCancel:show,onConfirm:async()=>{if(await saveConfirmed(removeNoteEntry(notes,entry.id))){ui.notify("Nota borrada");ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)}}})});show()}
// Modo conversación: escucha continua en primer plano. Reutiliza sin
// modificarlo el mismo add() que usa el compositor normal (el intérprete y
// las confirmaciones de calendario/recordatorios costaron muchas rondas de
// ajuste y no se tocan aquí), así que este bloque solo decide QUÉ turno
// mandarle a add() y QUÉ hacer con lo que add() deja en pantalla:
//  - Si add() deja una pregunta de aclaración (#conversationDraft), Angeli
//    la lee en voz alta y seguimos escuchando la respuesta.
//  - Si add() deja una confirmación que se autocierra (showCompletion),
//    Angeli la lee y volvemos a escuchar una instrucción nueva.
//  - Si add() deja cualquier otro modal (crear evento, elegir entre varias
//    notas, editor de nota…), son decisiones con varias opciones que hoy YA
//    exigen un toque en pantalla incluso dictando por el compositor normal;
//    en modo conversación pausamos el micrófono, lo anunciamos y reanudamos
//    solos en cuanto ese modal se cierra.
let conversationOn=false,conversationListening=false,conversationBusy=false,conversationRec=null,conversationTurnDispatched=false,conversationModalObserver=null,conversationManualStop=false;

function conversationModalKind(){
 if(!$("actionModal").classList.contains("show"))return"closed";
 if($("actionModal").classList.contains("completion-modal"))return"completion";
 if($("conversationDraft"))return"question";
 return"manual";
}

// Preferencia de voz: la app no puede instalar voces nuevas (eso solo lo
// hace el sistema operativo), pero sí puede recordar cuál de las voces YA
// instaladas en el teléfono prefiere el usuario, y a qué velocidad/tono.
// Es una preferencia de este dispositivo, no un dato de Angeli: se guarda en
// localStorage, no en Firestore.
const VOICE_PREF_KEY="angeliVoicePrefs";
function loadVoicePrefs(){try{return JSON.parse(localStorage.getItem(VOICE_PREF_KEY)||"{}")}catch(e){return{}}}
function saveVoicePrefs(){try{localStorage.setItem(VOICE_PREF_KEY,JSON.stringify(voicePrefs))}catch(e){}}
let voicePrefs=loadVoicePrefs();
function availableVoices(){return("speechSynthesis"in window)?window.speechSynthesis.getVoices():[]}
function selectedVoice(){
 const voices=availableVoices();
 if(!voices.length)return null;
 const byUri=voicePrefs.voiceURI&&voices.find(v=>v.voiceURI===voicePrefs.voiceURI);
 return byUri||voices.find(v=>(v.lang||"").toLowerCase().startsWith("es"))||voices[0];
}
function renderVoiceOptions(){
 const select=$("voiceSelect");
 if(!select)return;
 const voices=availableVoices();
 const current=selectedVoice();
 select.innerHTML="";
 voices.forEach(voice=>{
  const option=document.createElement("option");
  option.value=voice.voiceURI;
  option.textContent=`${voice.name} (${voice.lang})`;
  select.appendChild(option);
 });
 if(current)select.value=current.voiceURI;
 const spanishVoices=voices.filter(v=>(v.lang||"").toLowerCase().startsWith("es")).length;
 $("voiceSettingsHint").hidden=voices.length===0||spanishVoices>2;
}
if("speechSynthesis"in window){renderVoiceOptions();window.speechSynthesis.addEventListener?.("voiceschanged",renderVoiceOptions)}

function speakAloud(text){
 return new Promise(resolve=>{
  if(!text||!("speechSynthesis"in window)){resolve();return}
  try{
   window.speechSynthesis.cancel();
   const utter=new SpeechSynthesisUtterance(text);
   utter.lang="es-ES";
   const voice=selectedVoice();
   if(voice)utter.voice=voice;
   utter.rate=voicePrefs.rate||1;
   utter.pitch=voicePrefs.pitch||1;
   utter.onend=()=>resolve();
   utter.onerror=()=>resolve();
   window.speechSynthesis.speak(utter);
  }catch(e){resolve()}
 });
}

function conversationActiveQuestionEntry(){return notes.find(entry=>entry.interaction?.status==="awaiting_input")||null}

// Muletillas genéricas (no atadas a notas/recordatorios/agenda concretos), en
// tono cercano de compañera, no de máquina. Se dicen SIEMPRE al capturar la
// frase, tarde poco o mucho Gemini en responder — hablar solo cuando tarda
// seguía sonando a "hablar contra una máquina" el resto de las veces.
// speakAloud() cancela cualquier habla en curso antes de decir el resultado
// real, así que como mucho se corta la muletilla a medias si la respuesta
// llega enseguida, nunca se solapan. Se elige una al azar, distinta cada vez.
const CONVERSATION_FILLERS=["¡Vale, voy!","Ok, dame un segundo…","Mmm, a ver…","¡Marchando!","Vale, lo miro…","Eh, sí, un momento…","Perfecto, dame un segundo…","A ver, a ver…","¡Ahora mismo!","Vale, va…"];
function pickConversationFiller(){return CONVERSATION_FILLERS[Math.floor(Math.random()*CONVERSATION_FILLERS.length)]}

// Módulo aparte (backend/app.py: /chat/aside), desacoplado del intérprete de
// órdenes: solo genera una reacción corta y variada de verdad (no una lista
// fija) mientras add() procesa. Si tarda más de este margen o falla por lo
// que sea, se cae a pickConversationFiller() — la garantía de "responde
// siempre" no depende nunca de que esta llamada funcione.
const CONVERSATION_ASIDE_TIMEOUT_MS=900;
async function speakConversationalAside(text){
 try{
  const idToken=await cloud.getAuthToken();
  const reply=await Promise.race([
   chatAside(text,idToken),
   new Promise((_,reject)=>setTimeout(()=>reject(new Error("aside_timeout")),CONVERSATION_ASIDE_TIMEOUT_MS))
  ]);
  await speakAloud(reply);
 }catch(e){
  await speakAloud(pickConversationFiller());
 }
}

function watchForModalClose(onClose){
 if(conversationModalObserver)conversationModalObserver.disconnect();
 conversationModalObserver=new MutationObserver(()=>{
  if(!$("actionModal").classList.contains("show")){
   conversationModalObserver?.disconnect();
   conversationModalObserver=null;
   onClose();
  }
 });
 conversationModalObserver.observe($("actionModal"),{attributes:true,attributeFilter:["class"]});
}

async function conversationHandleOutcome(){
 const kind=conversationModalKind();
 if(kind==="completion"){
  const spoken=[$("modalTitle").textContent,$("modalLead").textContent].filter(Boolean).join(". ");
  ui.addConversationTurn("angeli",spoken);
  ui.setConversationStatus("Angeli está hablando…");
  await speakAloud(spoken);
  ui.closeLayers();
  resumeConversationListening();
  return;
 }
 if(kind==="question"){
  const spoken=$("modalLead").textContent||$("modalTitle").textContent;
  ui.addConversationTurn("angeli",spoken);
  ui.setConversationStatus("Angeli está hablando…");
  await speakAloud(spoken);
  resumeConversationListening();
  return;
 }
 if(kind==="manual"){
  // Antes se decía siempre la misma frase genérica ("elige una opción en la
  // pantalla"), sin relación con lo que realmente se estaba haciendo. El
  // propio modal ya trae un título y una explicación concretos para cada
  // caso (nota, recordatorio, evento con aviso...) — ahora se leen tal
  // cual, y si hay una acción principal clara (el botón "confirm"/"danger"),
  // se nombra para que sepa exactamente qué tocar.
  const title=$("modalTitle").textContent||"";
  const lead=$("modalLead").textContent||"";
  const primaryButton=$("modalActions").querySelector("button.confirm, button.danger");
  const primaryLabel=primaryButton?.textContent?.trim();
  const spoken=[title,lead].filter(Boolean).join(". ")+(primaryLabel?` Toca «${primaryLabel}» para continuar.`:" Toca en la pantalla para continuar.");
  ui.addConversationTurn("angeli",spoken);
  ui.setConversationStatus(primaryLabel?`Toca «${primaryLabel}» para continuar`:"Toca en la pantalla para continuar");
  await speakAloud(spoken);
  watchForModalClose(()=>{if(conversationOn)resumeConversationListening()});
  return;
 }
 const toast=$("toast");
 if(toast.classList.contains("show")){
  ui.addConversationTurn("angeli",toast.textContent);
  await speakAloud(toast.textContent);
 }
 ui.setConversationStatus("Toca el micrófono para hablar");
 resumeConversationListening();
}

async function conversationRunTurn(text){
 conversationBusy=true;
 ui.addConversationTurn("me",text);
 ui.setConversationStatus("Angeli está pensando…");
 const active=conversationActiveQuestionEntry();
 $("text").value=text;finalText=text;
 void speakConversationalAside(text);
 try{active?await add({interactionId:active.id}):await add()}catch(e){}
 // conversationBusy se libera ANTES de leer/hablar el resultado: cada rama
 // de conversationHandleOutcome termina reanudando la escucha, y
 // startConversationRecognizer se niega a arrancar mientras conversationBusy
 // sea true (para no solaparse con el propio add()). Liberarlo después
 // dejaba la reanudación como un no-op silencioso.
 conversationBusy=false;
 await conversationHandleOutcome();
}

function stopConversationRecognizer(){
 conversationListening=false;
 // .stop() también dispara onend: sin esta marca, onend no distingue una
 // pausa manual de un final de frase natural y relanzaba la escucha sola.
 conversationManualStop=true;
 if(conversationRec){try{conversationRec.stop()}catch(e){}}
 conversationRec=null;
 $("conversationModeMic").classList.remove("listening");
}

function startConversationRecognizer(){
 if(!conversationOn||conversationListening||conversationBusy)return;
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR){ui.setConversationStatus("Este navegador no admite dictado");return}
 conversationTurnDispatched=false;
 conversationRec=new SR();
 conversationRec.lang="es-ES";
 conversationRec.continuous=false;
 conversationRec.interimResults=true;
 conversationRec.maxAlternatives=1;
 conversationRec.onstart=()=>{conversationListening=true;$("conversationModeMic").classList.add("listening");ui.setConversationStatus("Escuchándote…")};
 conversationRec.onresult=event=>{
  // Regresión real detectada en dispositivo: con continuous:false, el
  // reconocedor puede entregar una frase larga en varios resultados
  // "finales" separados (una pausa breve a mitad de frase) antes de acabar
  // la sesión. Sin este guard, cada resultado final disparaba su propio
  // conversationRunTurn en paralelo con el anterior todavía en marcha,
  // duplicando la entrada guardada (dos recordatorios para la misma orden).
  if(conversationTurnDispatched)return;
  let finalPhrase="";
  for(let i=event.resultIndex;i<event.results.length;i++){
   const result=event.results[i],phrase=(result[0]?.transcript||"").trim();
   if(result.isFinal&&phrase)finalPhrase+=(finalPhrase?" ":"")+phrase;
  }
  if(finalPhrase){conversationTurnDispatched=true;try{conversationRec?.stop()}catch(e){}void conversationRunTurn(finalPhrase)}
 };
 conversationRec.onerror=event=>{
  conversationListening=false;
  $("conversationModeMic").classList.remove("listening");
  if(event.error==="not-allowed"){ui.setConversationStatus("Permiso de micrófono denegado");conversationOn=false;return}
  if(event.error==="no-speech"||event.error==="aborted")return;
  ui.setConversationStatus("Error de escucha: "+event.error);
 };
 conversationRec.onend=()=>{
  conversationListening=false;
  $("conversationModeMic").classList.remove("listening");
  const manualStop=conversationManualStop;
  conversationManualStop=false;
  if(!manualStop&&!conversationTurnDispatched&&conversationOn&&!conversationBusy&&conversationModalKind()!=="manual")startConversationRecognizer();
 };
 try{conversationRec.start()}catch(e){ui.setConversationStatus("No se pudo iniciar el micrófono")}
}

function resumeConversationListening(){if(conversationOn)startConversationRecognizer()}

function toggleConversationMic(){
 if(!conversationOn)return;
 if(conversationListening){stopConversationRecognizer();ui.setConversationStatus("Toca el micrófono para continuar")}
 else startConversationRecognizer();
}

function openConversationModeReal(){
 if(!window.SpeechRecognition&&!window.webkitSpeechRecognition){ui.notify("Este navegador no admite dictado por voz");return}
 clearComposer();
 conversationOn=true;
 ui.openConversationMode();
}

function closeConversationModeReal(){
 conversationOn=false;
 stopConversationRecognizer();
 if("speechSynthesis"in window)window.speechSynthesis.cancel();
 if(conversationModalObserver){conversationModalObserver.disconnect();conversationModalObserver=null}
 // Cerrar la pantalla no debe dejar una pregunta a medias: si se limitara a
 // ocultar el modal, la interacción seguiría "awaiting_input" en los datos y
 // conversationActiveQuestionEntry() la recogería en la próxima sesión,
 // colando una frase nueva y sin relación como respuesta a la pregunta vieja.
 const active=conversationActiveQuestionEntry();
 if(active)void cancelActive(active);
 else if(conversationModalKind()!=="closed")ui.closeLayers();
 ui.closeConversationMode();
}

async function persistShoppingList(next){
 shoppingList=next;
 if($("shoppingLibrary").classList.contains("show"))ui.renderShoppingList(shoppingList);
 try{await cloud.saveShoppingList(shoppingList)}catch(_){ui.notify("La lista de la compra sigue pendiente de sincronizar")}
}
// Cuando se dice "de mercadona", buscamos el producto de verdad para que
// quede su precio y su enlace — pero es un extra: si falla (red, catálogo
// caído) el artículo se queda igualmente en la lista, solo que sin producto
// vinculado. Nunca debe bloquear ni deshacer el añadido.
async function linkMercadonaMatches(mercadonaItems){
 if(!mercadonaItems.length)return;
 let idToken;
 try{idToken=await cloud.getAuthToken()}catch(_){return}
 for(const addition of mercadonaItems){
  try{
   const results=await searchMercadonaProduct(addition.name,idToken);
   if(!results.length)continue;
   const target=shoppingList.find(item=>!item.checked&&!item.product&&item.store==="mercadona"&&item.name.toLowerCase()===addition.name.toLowerCase());
   if(!target)continue;
   await persistShoppingList(setShoppingItemProduct(shoppingList,target.id,results[0]));
  }catch(_){/* el artículo se queda en la lista sin producto vinculado */}
 }
}
async function runShoppingCommand(command){
 if(!cloud.isSignedIn()){ui.notify("Inicia sesión en Angeli antes de guardar");return}
 if(command.action==="query"){openShoppingList();return}
 if(command.action==="clear"){await persistShoppingList(clearShoppingList(shoppingList));ui.notify("Lista de la compra vaciada");return}
 if(command.action==="add"){
  await persistShoppingList(addShoppingItems(shoppingList,command.items));
  ui.notify("Añadido a la lista de la compra: "+describeShoppingItems(command.items));
  void linkMercadonaMatches(command.items.filter(item=>item.store==="mercadona"));
  return;
 }
 if(command.action==="remove"){await persistShoppingList(removeShoppingItems(shoppingList,command.items));ui.notify("Quitado de la lista de la compra: "+describeShoppingItems(command.items));return}
 if(command.action==="check"){await persistShoppingList(checkShoppingItems(shoppingList,command.items,true));ui.notify("Marcado como comprado: "+describeShoppingItems(command.items));return}
}
// "busca leche en mercadona": no exige mencionar la lista, así que se separa
// de runShoppingCommand (que sí escribe la lista y por tanto exige sesión).
// Consum no tiene catálogo de productos (visto al investigar la API), así
// que se avisa en vez de intentar una búsqueda que nunca va a dar nada.
function runShoppingSearchCommand(command){
 openShoppingList();
 if(command.store==="consum"){ui.notify("Consum no tiene catálogo de productos disponible todavía; puedes añadirlo indicando la tienda igualmente");return}
 $("shoppingInput").value=command.query;
 scheduleShoppingSearch();
}
function openShoppingList(){ui.openShoppingList(shoppingList)}
function shoppingItemClick(event){
 const button=event.target.closest("[data-a]");
 if(!button)return;
 const id=button.closest("[data-shopping-id]")?.dataset.shoppingId;
 if(!id)return;
 const action=button.dataset.a;
 if(action==="toggle")void persistShoppingList(toggleShoppingItem(shoppingList,id));
 else if(action==="remove")void persistShoppingList(removeShoppingItemById(shoppingList,id));
 else if(action==="qty-inc"||action==="qty-dec"){
  const item=shoppingList.find(entry=>entry.id===id);
  if(!item)return;
  void persistShoppingList(setShoppingItemQuantity(shoppingList,id,(item.quantity||1)+(action==="qty-inc"?1:-1)));
 }
}
function addShoppingItemManually(){
 const input=$("shoppingInput"),value=input.value.trim();
 if(!value){ui.notify("Escribe algo para añadir");return}
 const items=parseItemList(value);
 if(!items.length){ui.notify("No he entendido ese artículo");return}
 input.value="";
 hideShoppingSuggestions();
 void runShoppingCommand({action:"add",items});
}
// Reportado: al escribir "leche" en el buscador no aparecía ninguna opción
// de Mercadona para elegir, solo se podía añadir el texto tal cual. Ahora
// busca en vivo (con un pequeño retraso para no lanzar una petición por
// cada tecla) y, si hay resultados, dejan elegir el producto exacto.
let shoppingSearchTimer=null,shoppingSearchSeq=0,shoppingSearchResults=[];
function hideShoppingSuggestions(){shoppingSearchResults=[];$("shoppingSuggestions").hidden=true;$("shoppingSuggestions").innerHTML=""}
function renderShoppingSuggestions(results){
 shoppingSearchResults=results;
 if(!results.length){hideShoppingSuggestions();return}
 $("shoppingSuggestions").hidden=false;
 $("shoppingSuggestions").innerHTML=results.map((product,index)=>'<button type="button" class="shopping-suggestion" data-suggestion="'+index+'"><span>'+esc(product.name)+(product.packaging?" · "+esc(product.packaging):"")+'</span>'+(product.price!=null?'<span class="shopping-suggestion-price">'+Number(product.price).toFixed(2)+" €</span>":"")+"</button>").join("");
}
async function runShoppingSearch(query){
 const seq=++shoppingSearchSeq;
 if(!cloud.isSignedIn())return;
 let idToken;
 try{idToken=await cloud.getAuthToken()}catch(_){return}
 let results=[];
 // El buscador manual es para explorar de verdad ("¿cuántas marcas de
 // cerveza hay?"), no solo para el primer emparejado automático por voz —
 // pide más resultados que el límite por defecto del backend (6).
 try{results=await searchMercadonaProduct(query,idToken,20)}catch(_){results=[]}
 if(seq!==shoppingSearchSeq)return; // ya se pidió otra búsqueda mientras esta estaba en curso
 renderShoppingSuggestions(results);
}
function scheduleShoppingSearch(){
 clearTimeout(shoppingSearchTimer);
 const value=$("shoppingInput").value.trim(),query=(parseItemList(value)[0]?.name||value).trim();
 if(query.length<2){hideShoppingSuggestions();return}
 shoppingSearchTimer=setTimeout(()=>void runShoppingSearch(query),350);
}
function selectShoppingSuggestion(index){
 const product=shoppingSearchResults[index];
 if(!product)return;
 $("shoppingInput").value="";
 hideShoppingSuggestions();
 let next=addShoppingItems(shoppingList,[{name:product.name,store:"mercadona"}]);
 const target=next.find(item=>!item.checked&&!item.product&&item.store==="mercadona"&&item.name.toLowerCase()===product.name.toLowerCase());
 if(target)next=setShoppingItemProduct(next,target.id,product);
 void persistShoppingList(next);
 ui.notify("Añadido a la lista de la compra: "+product.name+" (mercadona)");
}

function openDietario(){ui.openDietario(notes,dietarioState)}
function refreshDietario(){ui.renderDietario(notes,dietarioState)}
function openDietarioEntry(id){
 const entry=notes.find(note=>note.id===id);
 if(!entry)return;
 ui.closeDietario();
 if(entry.type==="note"){openNoteLibraryDetail(entry);return}
 if(entry.type==="photo"||entry.type==="file"){
  const item=mediaLibraryItems([entry])[0];
  if(item){openLibraryEntry(item);return}
 }
 ui.showDietarioDetail(entry);
}
function toggleEntryStatus(note){save(notes.map(item=>item.id===note.id?{...item,status:item.status==="done"?"pending":"done"}:item))}
async function deleteEntry(note){
 // Confirmado por el usuario: había que comprobar si borrar una entrada
 // también retira su evento o aviso de Calendar. No lo hacía — se quedaban
 // huérfanos en el Calendar real aunque la entrada desapareciera de Angeli.
 const hasCalendarTraces=Boolean((note.calendarEventId&&note.calendarStatus==="synced")||(note.schedule?.calendarEventId&&note.schedule?.status==="scheduled"));
 if(!save(notes.filter(item=>item.id!==note.id)))return false;
 google.clearContactResult(note.id);
 if(hasCalendarTraces&&!await google.deleteCalendarTracesFor(note).catch(()=>false))ui.notify("La entrada se borró, pero el evento o aviso sigue en Calendar; revísalo si hace falta");
 try{for(const image of note.images||[])await media.remove(typeof image==="string"?image:image.driveFileId||image.id);for(const file of note.files||[])if(file.id||file.driveFileId)await media.remove(file.driveFileId||file.id)}catch(e){ui.notify("La entrada se borró, pero quedó algún adjunto en Drive")}
 return true;
}
// Pulsación larga sobre una línea del dietario: acceso rápido para marcar
// como hecho o eliminar, sin tener que abrir la ficha completa primero.
function openDietarioQuickActions(id){
 const entry=notes.find(note=>note.id===id);
 if(!entry)return;
 const done=entry.status==="done",afterAction=()=>{ui.closeLayers();refreshDietario()};
 ui.openModal({
  title:entry.aiIntent?.title||entry.text||"Elemento",
  lead:"¿Qué quieres hacer con este elemento del dietario?",
  actions:[
   {label:done?"↺ Reabrir":"✓ Marcar como hecho",kind:"secondary",onClick:()=>{toggleEntryStatus(entry);afterAction()}},
   {label:"🗑️ Eliminar",kind:"danger",onClick:async()=>{await deleteEntry(entry);afterAction()}},
   {label:"Cancelar",kind:"secondary",onClick:ui.closeLayers}
  ]
 });
}
async function downloadLibraryItem(item,{share=false}={}){
 try{
  ui.notify(share?"Preparando para compartir…":"Abriendo archivo…");
  const result=await media.getMedia(item.driveId),file=new File([result.blob],item.name,{type:result.type||item.mimeType});
  if(share&&navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({files:[file],title:item.name,text:item.entryText});return}
  const url=URL.createObjectURL(result.blob),link=document.createElement("a");link.href=url;if(share)link.download=item.name;link.target="_blank";link.rel="noopener";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  if(share)ui.notify("Tu dispositivo no ofrece compartir aquí; he descargado el archivo")
 }catch(error){if(error?.name!=="AbortError")ui.notify("No se pudo recuperar el archivo")}
}
async function openLibraryItem(item){
 if(item.kind!=="image"){await downloadLibraryItem(item);return}
 try{ui.notify("Cargando imagen…");const result=await media.getMedia(item.driveId),url=URL.createObjectURL(result.blob);ui.showMediaViewer(item,url,{onEntry:()=>openLibraryEntry(item),onShare:()=>downloadLibraryItem(item,{share:true})})}catch(_){ui.notify("No se pudo ampliar la imagen")}
}

$("mic").onclick=start;$("micMini").onclick=start;
$("clear").onclick=()=>{$("text").value="";finalText="";pendingShortcut=null;autosize();ui.notify("Borrador limpiado")};
$("contactsConnect").onclick=google.connectContacts;
$("contactsDisconnect").onclick=google.disconnectContacts;
$("calendarConnect").onclick=google.connectCalendar;
$("calendarDisconnect").onclick=google.disconnectCalendar;
$("driveConnect").onclick=google.connectDrive;
$("driveDisconnect").onclick=google.disconnectDrive;
$("aiConnect").onclick=cloud.connect;
$("aiDisconnect").onclick=cloud.disconnect;
function showNotificationSettings(){
 ui.showNotificationSettings(notificationSettings,{status:cloud.pushStatus(),onActivate:async()=>{try{await cloud.enablePush(true);ui.notify("Avisos activados en este dispositivo");showNotificationSettings()}catch(error){ui.notify(error.message||"No se pudieron activar los avisos")}},onTest:async()=>{try{const result=await cloud.testPush();ui.notify(result.delivered?"Aviso de prueba enviado":"No hay dispositivos activos")}catch(error){ui.notify(error.message||"No se pudo enviar el aviso de prueba")}},onDisable:async()=>{try{await cloud.disablePush();ui.notify("Avisos desactivados en este dispositivo");showNotificationSettings()}catch(error){ui.notify(error.message||"No se pudieron desactivar los avisos")}},onSave:async value=>{notificationSettings=normalizeNotificationSettings(value);try{await cloud.saveNotificationSettings(notificationSettings);const eligible=notes.filter(entry=>entry.schedule?.status==="scheduled"||(entry.type==="calendar"&&entry.calendarStatus==="synced")||(entry.type==="task"&&entry.status==="pending"&&entry.scheduledDate&&entry.scheduledTime));const results=await Promise.allSettled(eligible.map(entry=>cloud.schedulePush(entry))),failed=results.filter(result=>result.status==="rejected").length;if(failed){ui.notify(`Ajustes guardados, pero ${failed} aviso${failed===1?" necesita":"s necesitan"} reintento`);return}ui.closeLayers();ui.notify("Ajustes de avisos guardados")}catch(error){ui.notify(error.message||"No se pudieron guardar los ajustes")}}});
}
$("pushSettings").onclick=()=>{ui.closeLayers();showNotificationSettings()};
$("resetData").onclick=async()=>{if(!confirm("Se borrará únicamente la caché temporal de este dispositivo. Tus entradas y adjuntos seguirán en Angeli y se volverán a cargar. ¿Continuar?"))return;try{await deleteMediaDB();clearNotes();clearPendingMedia();$("text").value="";ui.notify("Caché local eliminada; tus datos siguen en Angeli")}catch(e){ui.notify("No se pudo eliminar toda la caché local")}};
$("add").onclick=add;
$("text").oninput=()=>{autosize();ui.updateDraft($("text").value)};
$("text").onfocus=()=>{if(!$("actionModal").classList.contains("show"))setTimeout(()=>{if(!$("actionModal").classList.contains("show"))openDraft()},120)};
$("text").onkeydown=event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();add()}};
$("attachToggle").onclick=()=>$("attachmentChoices").classList.toggle("show");
$("galleryOpen").onclick=()=>openLibrary("image");
$("filesOpen").onclick=()=>openLibrary("file");
$("notesOpen").onclick=openNoteLibrary;
$("remindersOpen").onclick=()=>void resolveReminderQuery(localReminderQuery("Recordatorios pendientes"));
$("agendaOpen").onclick=()=>prepareShortcut({label:"Calendario",command:"Muéstrame mi agenda",action:"calendar.query",direct:true});
$("dietarioOpen").onclick=openDietario;
$("shoppingOpen").onclick=openShoppingList;
$("shoppingClose").onclick=()=>{ui.closeShoppingList();hideShoppingSuggestions()};
$("shoppingList").onclick=shoppingItemClick;
$("shoppingAdd").onclick=addShoppingItemManually;
$("shoppingMic").onclick=()=>start({inConversation:true,draftId:"shoppingInput"});
$("shoppingInput").onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();addShoppingItemManually()}};
$("shoppingInput").oninput=scheduleShoppingSearch;
$("shoppingSuggestions").onclick=event=>{const button=event.target.closest("[data-suggestion]");if(button)selectShoppingSuggestion(Number(button.dataset.suggestion))};
$("shoppingClearChecked").onclick=()=>void persistShoppingList(clearShoppingList(shoppingList,{onlyChecked:true}));
$("shoppingClearAll").onclick=()=>{if(shoppingList.length&&!confirm("¿Vaciar toda la lista de la compra?"))return;void persistShoppingList(clearShoppingList(shoppingList))};
$("conversationModeOpen").onclick=openConversationModeReal;
$("conversationModeClose").onclick=closeConversationModeReal;
$("conversationModeMic").onclick=toggleConversationMic;
$("dietarioClose").onclick=ui.closeDietario;
$("dietarioRangeFilters").onclick=event=>{const button=event.target.closest("[data-dietario-range]");if(!button)return;dietarioState.range=button.dataset.dietarioRange;document.querySelectorAll("[data-dietario-range]").forEach(item=>item.classList.toggle("active",item===button));refreshDietario()};
$("dietarioTypeFilters").onclick=event=>{const button=event.target.closest("[data-dietario-type]");if(!button)return;dietarioState.type=button.dataset.dietarioType;document.querySelectorAll("[data-dietario-type]").forEach(item=>item.classList.toggle("active",item===button));refreshDietario()};
$("dietarioList").onclick=event=>{
 const quick=event.target.closest("[data-dietario-quick]");
 if(quick){openDietarioQuickActions(quick.dataset.dietarioQuick);return}
 const item=event.target.closest("[data-dietario-id]");
 if(item)openDietarioEntry(item.dataset.dietarioId)
};
$("libraryClose").onclick=ui.closeMediaLibrary;
$("viewerClose").onclick=ui.closeMediaViewer;
$("librarySearch").oninput=event=>{libraryState.query=event.target.value;refreshLibrary()};
$("libraryCategory").onchange=event=>{libraryState.category=event.target.value;refreshLibrary()};
document.querySelector(".library-filters").onclick=event=>{const button=event.target.closest("[data-library-kind]");if(!button)return;libraryState.kind=button.dataset.libraryKind;document.querySelectorAll("[data-library-kind]").forEach(item=>item.classList.toggle("active",item===button));refreshLibrary()};
$("libraryList").onclick=event=>{const button=event.target.closest("[data-library-action]");if(!button)return;const item=libraryItem(button.dataset.libraryKey);if(!item)return;const action=button.dataset.libraryAction;if(action==="entry")openLibraryEntry(item);else if(action==="share")void downloadLibraryItem(item,{share:true});else void openLibraryItem(item)};
$("noteLibraryClose").onclick=ui.closeNoteLibrary;
$("noteLibrarySearch").oninput=event=>{noteLibraryState.query=event.target.value;refreshNoteLibrary()};
$("noteLibraryCategory").onchange=event=>{noteLibraryState.category=event.target.value;refreshNoteLibrary()};
document.querySelector("#noteLibrary .library-filters").onclick=event=>{const button=event.target.closest("[data-note-status]");if(!button)return;noteLibraryState.status=button.dataset.noteStatus;document.querySelectorAll("[data-note-status]").forEach(item=>item.classList.toggle("active",item===button));refreshNoteLibrary()};
$("noteLibraryList").onclick=event=>{const button=event.target.closest("[data-note-action]");if(!button)return;const entry=noteLibraryEntry(button.dataset.noteId);if(!entry)return;const action=button.dataset.noteAction;if(action==="open")openNoteLibraryDetail(entry);else if(action==="edit"){ui.closeNoteLibrary();editNoteFromLibrary(entry,()=>{ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)})}else if(action==="toggle")void(async()=>{const updated=updateNoteStatus(entry,entry.status==="done"?"pending":"done");if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){ui.notify(updated.status==="done"?"Nota marcada como hecha":"Nota reabierta");refreshNoteLibrary()}})();else if(action==="delete"){ui.closeNoteLibrary();ui.showNoteDeleteConfirmation(entry,{onCancel:()=>{ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)},onConfirm:async()=>{if(await saveConfirmed(removeNoteEntry(notes,entry.id))){ui.notify("Nota borrada");ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)}}})}};
$("menuOpen").onclick=ui.openMenu;$("menuClose").onclick=ui.closeLayers;$("scrim").onclick=()=>{if(!$("actionModal").classList.contains("conversation-modal"))ui.closeLayers()};
$("clearView").onclick=()=>{if(confirm("Esto limpia solo la conversación visible. Tus entradas, fotos y archivos seguirán guardados. ¿Continuar?")){$("list").innerHTML='<div class="empty">Vista limpia. Tus datos siguen guardados.</div>';ui.notify("Vista limpiada")}};
$("shortcutManual").onclick=()=>createShortcut();
$("shortcutVoice").onclick=()=>{shortcutCapture=true;$("text").value="";$("text").placeholder="Di la orden que ejecutará el acceso directo…";ui.closeLayers();start()};
$("shortcutEdit").onclick=editShortcuts;
$("noteSettingsOpen").onclick=()=>{ui.closeLayers();showNoteSettings()};
$("voiceRate").value=voicePrefs.rate??1;
$("voicePitch").value=voicePrefs.pitch??1;
$("voiceSelect").onchange=()=>{voicePrefs.voiceURI=$("voiceSelect").value;saveVoicePrefs()};
$("voiceRate").oninput=()=>{voicePrefs.rate=Number($("voiceRate").value);saveVoicePrefs()};
$("voicePitch").oninput=()=>{voicePrefs.pitch=Number($("voicePitch").value);saveVoicePrefs()};
$("voiceTest").onclick=()=>void speakAloud("Hola, soy Angeli. Así sonaré a partir de ahora.");
$("cameraInput").onchange=e=>{if(e.target.files.length)readImages([...e.target.files],"Foto preparada")};
$("photoInput").onchange=e=>{if(e.target.files.length)readImages([...e.target.files],"Imagen seleccionada")};
$("fileInput").onchange=e=>{if(e.target.files.length)prepareMedia([...e.target.files],"file","Archivo preparado")};
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
 if(action==="edit-calendar-datetime"){
  ui.showCalendarDateTimeEditor(note,{onCancel:()=>ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google),onSave:async value=>{const next=updateCalendarDateTime(note,value.date,value.time);if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});
  return;
 }
 if(action==="defer-call-reminder"||action==="defer-call-calendar"){
  const intent=action==="defer-call-calendar"?"calendar.create":"reminder.create";
  const turn=resolveConversationTurn({active:{...note,interaction:{...note.interaction,status:"completed"}},text:button.textContent,interpretation:deferredCallIntent(note,intent)});
  const proposal=planIntent(turn.interpretation),next={...note,type:entryTypeForIntent(proposal),aiIntent:turn.interpretation,proposal,interaction:turn.interaction};
  if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))continueConversation(next);
  return;
 }
 if(action==="agenda-view"){
  const showEvent=()=>ui.showCalendarEvent(note,google,button.dataset.eventId,{onEdit:event=>ui.showCalendarEventEditor(event,{onCancel:showEvent,onSave:async changes=>{if(!changes.title||(!event.allDay&&(!changes.date||!changes.time))){ui.notify("Indica título, fecha y hora");return}ui.showWorking("Actualizando evento","Guardando los cambios en Calendar…","");if(await google.updateListedCalendarEvent(note,event.id,changes))showEvent();else ui.showEntryAction(note,google)}})});
  showEvent();return
 }
 if(action==="agenda-delete"){await cancelAgendaEvent(note,button.dataset.eventId);return}
 if(action==="show-action"){ui.showEntryAction(note,google);return}
 if(action==="schedule"){
  ui.showWorking("Programando aviso","Angeli está creando el aviso en Calendar…","");
  await google.createScheduledReminder(note);
  const current=notes.find(item=>item.id===note.id)||note;
  if(current.schedule?.status==="scheduled")completeCurrentAction(note.id);
  ui.showEntryAction(notes.find(item=>item.id===note.id)||current,google);return;
 }
 if(action==="calendar-bundle"){
  ui.showWorking("Añadiendo evento y aviso","Angeli está creando los dos elementos relacionados en Calendar…","");
  await google.createLinkedCalendarBundle(note);
  const current=notes.find(item=>item.id===note.id)||note;
  if(current.calendarStatus==="synced"&&current.schedule?.status==="scheduled")completeCurrentAction(note.id);
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
 if(action==="edit-whatsapp"){
  ui.showWhatsAppEditor(note,{onMic:draftId=>start({inConversation:true,draftId}),onCancel:()=>ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google),onSave:async message=>{const next={...note,aiIntent:{...note.aiIntent,notes:message},interaction:{...note.interaction,collectedData:{...(note.interaction?.collectedData||{}),notes:message},updatedAt:new Date().toISOString()}};if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});return;
 }
 if(action==="edit-whatsapp-phone"){
  ui.showWhatsAppPhoneEditor(note,{onCancel:()=>ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google),onSave:async phone=>{const next={...note,phone,aiIntent:{...note.aiIntent,phone},interaction:{...note.interaction,collectedData:{...(note.interaction?.collectedData||{}),phone},updatedAt:new Date().toISOString()}};if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});return;
 }
 if(action==="open-whatsapp"){
  try{const url=whatsappUrl(button.dataset.phone,note.aiIntent?.notes),link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener";document.body.append(link);completeCurrentAction(note.id);ui.closeLayers();link.click();link.remove();ui.notify("Mensaje preparado en WhatsApp")}catch(error){ui.notify(error.message||"No se pudo abrir WhatsApp")}return;
 }
 if(action==="search-contact"){
  ui.showWorking("Buscando contacto","Angeli está buscando a "+(note.contactQuery||"ese contacto")+"…","");
  await google.searchContact(note);ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google);return;
 }
 if(action==="open-file"){
  try{const media=await mediaServiceGet(button.dataset.mediaId);if(!media)throw new Error();const url=URL.createObjectURL(media.blob);window.open(url,"_blank");setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){ui.notify("No se pudo abrir el archivo")};return;
 }
 if(action==="toggle"){toggleEntryStatus(note);return}
 if(action==="delete"){await deleteEntry(note);return}
}
$("list").onclick=handleEntryAction;$("actionModal").onclick=handleEntryAction;
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&Date.now()-lastConnectionCheck>120000)void verifyConnections(true)});
window.addEventListener("online",()=>void verifyConnections(true));
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=0.21.82",{updateViaCache:"none"}).then(registration=>registration.update()).catch(()=>{});
load();

async function mediaServiceGet(id){return media.getMedia(id)}
function esc(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]))}
