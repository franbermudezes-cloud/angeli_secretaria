import{clearNotes,deleteMediaDB,readShortcuts,writeShortcuts,readShortcutsHidden,writeShortcutsHidden}from"./storage.js?v=0.23.5";
import{classify,actionData}from"./classifier.js?v=0.23.5";
import{sendEntry}from"./sheets.js?v=0.23.5";
import{createUI}from"./ui.js?v=0.23.5";
import{createGoogleIntegration}from"./google.js?v=0.23.5";
import{interpret,remoteProvider,chatAside,searchMercadonaProduct,localReminderQuery,localNoteQuery,localCalendarCancellation,localCalendarUpdate,localLinkedCalendarIntent,localImmediateCall,activeIntentDomain,explicitNewCommandDomain,protectCalendarInterpretation,protectContactCallInterpretation,protectReadQuery}from"./ai.js?v=0.23.5";
import{parseShoppingCommand,parseItemList,addShoppingItems,removeShoppingItems,checkShoppingItems,clearShoppingList,toggleShoppingItem,removeShoppingItemById,setShoppingItemProduct,setShoppingItemQuantity,describeShoppingItems,shoppingListTotal,normalizeShoppingState,getActiveList,findListByName,createShoppingList,renameShoppingList,deleteShoppingList,setActiveShoppingList,setShoppingListStore,isMercadonaList,updateListItems,addCheckedToCart,toggleCartItem,setCartItemQuantity,removeCartItem,finalizePurchase}from"./shopping.js?v=0.23.5";
import{entryTypeForIntent,planIntent}from"./intents.js?v=0.23.5";
import{calendarQueryRange,temporalData}from"./temporal.js?v=0.23.5";
import{normalizeFutureCall,normalizeReminderSchedule,normalizeUndatedCall,deferredCallIntent,scheduleFor,linkedScheduleFor,updateCalendarDetails,updateCalendarDateTime,calendarDetails}from"./schedule.js?v=0.23.5";
import{createCloudSync}from"./firebase.js?v=0.23.5";
import{createMediaService}from"./media.js?v=0.23.5";
import{cancelInteraction,completeInteraction,contextFor,resolveConversationTurn,preserveCancellation}from"./conversation.js?v=0.23.5";
import{completionTarget,completePendingWithCalendar,findPendingMatches,findReminderMatches,markCancelledReminder}from"./pending.js?v=0.23.5";
import{createAgendaActions}from"./agenda.js?v=0.23.5";
import{prepareNoteDraft,missingNoteDraftFields,findNoteMatches,noteClassificationFromIntent,removeNoteEntry,updateNoteDraft,updateNoteStatus}from"./notes.js?v=0.23.5";
import{DEFAULT_NOTE_SETTINGS,addNoteSetting,applyExplicitNoteCategory,normalizeNoteSettings,noteInterpretationContext,removeNoteSetting,renameNoteSetting,settingLabel}from"./note-settings.js?v=0.23.5";
import{DEFAULT_SHORTCUTS,SHORTCUT_PRESETS,normalizeShortcuts,routeShortcutIntent,shortcutPrefix,shortcutType}from"./shortcuts.js?v=0.23.5";
import{localWhatsApp,whatsappUrl}from"./whatsapp.js?v=0.23.5";
import{DEFAULT_NOTIFICATION_SETTINGS,normalizeNotificationSettings}from"./notification-settings.js?v=0.23.5";
import{mediaLibraryItems}from"./media-library.js?v=0.23.5";
import{mediaContextComplete,normalizeMediaContext}from"./media-context.js?v=0.23.5";

let media;const ui=createUI({getMedia:(_,id)=>media.getMedia(id)});const $=ui.$;
let notes=[],rec=null,finalText="",pendingImages=[],pendingFiles=[],pendingMediaContext=null,selectedFilter="all",selectedType="all",shortcutCapture=false,pendingShortcut=null,saving=false,noteDraftSaving=false;
// Fricción/calidad de código de la auditoría completa: si el micrófono del
// compositor está escuchando ahora mismo era una variable global suelta
// (`listening`) tocada directamente desde cinco sitios distintos (start,
// stop, y los tres manejadores rec.onstart/onerror/onend) — la misma clase
// de fallo que causó el bug de "micrófonos huérfanos" (V0.21.95, V0.22.5):
// bastaba con olvidar actualizar uno de esos cinco sitios para dejar el
// estado desincronizado del micrófono real. Se agrupa en un objeto con dos
// métodos explícitos en vez de una variable suelta que cualquiera puede
// reasignar sin darse cuenta de que hay más sitios que dependen de ella.
const dictationMic={active:false,isActive(){return this.active},set(value){this.active=value}};
let lastConnectionCheck=0;
let noteSettings=normalizeNoteSettings(DEFAULT_NOTE_SETTINGS);
let notificationSettings=normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
let libraryState={kind:"all",category:"all",query:""};
let noteLibraryState={status:"pending",category:"all",query:""};
let dietarioState={range:"week",type:"all"};
let shoppingState=normalizeShoppingState(null),shoppingView="overview",shoppingConfirmTimer=null,shoppingConfirmSeq=0,shoppingConfirmResults=[];
let shortcuts=normalizeShortcuts(readShortcuts()||DEFAULT_SHORTCUTS),shortcutsHidden=readShortcutsHidden();
// Última copia sincronizada con la nube (o, si nunca se ha sincronizado
// todavía, la que había en local al arrancar). saveShortcuts() la compara
// con `shortcuts` para saber qué cambió de verdad EN ESTE dispositivo desde
// la última sincronización — ver el comentario de diffShortcuts en
// js/shortcuts.js sobre por qué hace falta esto y no basta con sobrescribir.
let shortcutsBaseline=shortcuts;
// Los avisos push llegan con "?reminder=<id>" (backend/push_notifications.py),
// pero hasta ahora nadie leía ese parámetro: tocar la notificación abría la
// app en la pantalla de siempre sin llevar a la entrada que la originó.
let pendingReminderFocus=new URLSearchParams(location.search).get("reminder")||null;
function render(){ui.render({notes,selectedFilter,selectedType,google,noteSettings});focusPendingReminder();if($("dietarioLibrary").classList.contains("show"))refreshDietario()}
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
 pendingReminderFocus=null;
 history.replaceState(null,"",location.pathname);
 // Real (encontrado en revisión): esto hacía scroll hasta la entrada dentro
 // de #list, que ahora está oculto para siempre — tocar el aviso abría la
 // app sin mostrar nada. Se enseña la misma ficha que ya se usa en el resto
 // de la app para ver una entrada, en vez de depender del feed oculto.
 ui.showEntryAction(target,google);
}
function autosize(){const text=$("text");text.style.height="auto";text.style.height=Math.min(text.scrollHeight,78)+"px"}
// Pedido explícito: poder dejar la pantalla principal "limpia", sin la fila
// de accesos directos ni el "＋" de crear uno nuevo — no basta con vaciar la
// lista, porque el "＋" seguiría apareciendo igualmente.
function renderShortcuts(){$("shortcutsSection").hidden=shortcutsHidden;$("shortcutsToggleHide").textContent=shortcutsHidden?"👁️ Mostrar accesos directos":"🙈 Ocultar accesos directos";if(shortcutsHidden)return;$("shortcuts").innerHTML=shortcuts.map((shortcut,index)=>`<button class="shortcut" data-shortcut="${index}">${esc(shortcut.label)}</button>`).join("")+`<button class="shortcut add" id="shortcutAdd" aria-label="Crear acceso directo">＋</button>`}
// Reportado por el propietario: el móvil tenía 7 accesos y el ordenador (PWA)
// solo 3 — cada dispositivo guardaba sus accesos únicamente en su propio
// localStorage (SHORTCUTS_KEY), sin sincronizar nunca con Firestore, a
// diferencia de la lista de la compra o los ajustes de notas. localStorage
// se mantiene como caché para abrir sin esperar a la nube, pero a partir de
// ahora cada cambio se sube también a users/{uid}/settings/shortcuts.
function saveShortcuts(){const previous=shortcutsBaseline;shortcuts=normalizeShortcuts(shortcuts);writeShortcuts(shortcuts);renderShortcuts();shortcutsBaseline=shortcuts;if(cloud.isSignedIn())void cloud.saveShortcuts(previous,shortcuts,shortcutsHidden).then(merged=>{shortcuts=merged;shortcutsBaseline=merged;writeShortcuts(merged);renderShortcuts()}).catch(()=>ui.notify("Los accesos directos siguen pendientes de sincronizar"))}
// Pedido explícito del propietario: un botón para ocultar del todo la fila
// de accesos directos (y su "＋") de la pantalla principal, no solo poder
// borrar accesos uno a uno. Se sincroniza junto con los propios accesos
// (mismo documento de Firestore) para que quede oculta o visible igual en
// todos los dispositivos, y se cachea en local para pintar sin esperar a
// la nube al abrir la app.
function toggleShortcutsHidden(){shortcutsHidden=!shortcutsHidden;writeShortcutsHidden(shortcutsHidden);renderShortcuts();if(cloud.isSignedIn())void cloud.saveShortcuts(shortcutsBaseline,shortcuts,shortcutsHidden).then(merged=>{shortcuts=merged;shortcutsBaseline=merged;writeShortcuts(merged);renderShortcuts()}).catch(()=>ui.notify("El ajuste sigue pendiente de sincronizar"));ui.notify(shortcutsHidden?"Accesos directos ocultos":"Accesos directos visibles")}
function prepareShortcut(shortcut){pendingShortcut=shortcut;if(shortcut.command){$("text").value=shortcut.command;autosize();add({shortcut});return}const prefix=shortcutPrefix(shortcut);$("text").value=prefix;$("text").placeholder=shortcut.prompt||"Escribe o dicta tu instrucción…";autosize();openDraft();if(shortcut.dictate||shortcut.action==="contact.call")setTimeout(start,120);else ui.notify(shortcut.prompt||"Completa la instrucción y pulsa Enviar")}
// Reportado en la 2ª auditoría: esto usaba dos prompt() nativos seguidos —
// hasta desde "🎙️ Dictar acceso", que en una app de voz obligaba a teclear
// el nombre en un cuadro feo después de dictar. Ahora usa el modal propio,
// con la orden ya dictada precargada y el nombre autocompletado.
function createShortcut(initial=""){ui.showShortcutEditor({command:initial,onSave:({command,label})=>{ui.closeLayers();shortcuts.push({label,command});saveShortcuts();ui.notify("Acceso directo creado")}})}
// Pedido explícito: "como había antes, que pudiera elegir ya accesos
// directos con su icono y todo ya puesto" — en vez de escribir el texto y
// buscar un icono a mano cada vez, se elige uno ya preparado de la lista.
// Se ocultan los que ya están en la pantalla principal (no tendría sentido
// ofrecer añadir uno que ya está); "Crear uno personalizado" es la puerta
// de salida al viejo flujo con prompt(), para lo que no encaje aquí.
function pickShortcutPreset(){
 const existingLabels=new Set(shortcuts.map(shortcut=>shortcut.label));
 const available=SHORTCUT_PRESETS.filter(preset=>!existingLabels.has(preset.label));
 ui.openModal({
  title:"Elegir acceso directo",
  lead:available.length?"Toca uno para añadirlo tal cual a la pantalla principal.":"Ya tienes todos los accesos sugeridos en la pantalla principal.",
  actions:[
   ...available.map(preset=>({label:preset.label,kind:"secondary",onClick:()=>{ui.closeLayers();shortcuts.push({...preset});saveShortcuts();ui.notify("Acceso directo añadido")}})),
   {label:"✎ Crear uno personalizado",kind:"secondary",onClick:()=>{ui.closeLayers();createShortcut()}},
   {label:"Cancelar",kind:"secondary",onClick:ui.closeLayers}
  ]
 });
}
// Pedido explícito: poder quitar de verdad un acceso directo de la
// pantalla principal desde Ajustes (no solo dejarlo fuera de la vista).
// Sustituye al viejo flujo con prompt() por un modal real, en línea con el
// resto de listas con "quitar" de esta app (listas de la compra, etc.).
function manageShortcuts(){
 ui.openModal({
  title:"Accesos directos",
  lead:shortcuts.length?"Toca uno para quitarlo de la pantalla principal.":"No tienes ningún acceso directo ahora mismo.",
  actions:[
   ...shortcuts.map((shortcut,index)=>({label:`🗑️ ${shortcut.label}`,kind:"danger",onClick:()=>{shortcuts.splice(index,1);saveShortcuts();ui.notify("Acceso directo eliminado");manageShortcuts()}})),
   {label:"＋ Crear acceso nuevo",kind:"secondary",onClick:()=>{ui.closeLayers();createShortcut()}},
   {label:"Cerrar",kind:"secondary",onClick:ui.closeLayers}
  ]
 });
}
function scrollConversation(){requestAnimationFrame(()=>$("mainContent").scrollTo({top:$("mainContent").scrollHeight,behavior:"smooth"}))}
function setSending(active){$("add").disabled=active}
function clearPendingMedia(){pendingImages=[];pendingFiles=[];pendingMediaContext=null;$("cameraInput").value="";$("photoInput").value="";$("fileInput").value="";$("preview").innerHTML="";}
function describePendingMedia(){return [...pendingImages,...pendingFiles].map(file=>file.name).filter(Boolean)}
// Pedido explícito: crear un tipo de relación nuevo (p. ej. "Familia") en el
// momento de clasificar un adjunto, sin tener que ir antes a Ajustes.
async function askMediaContext(){
 ui.showMediaContextEditor({files:describePendingMedia(),context:pendingMediaContext,settings:noteSettings,onCancel:clearPendingMedia,onSave:async values=>{
  let relationType=values.relationType;
  if(relationType==="__new__"){
   const before=new Set(noteSettings.relationTypes.map(option=>option.id));
   if(!await saveNoteSettings(addNoteSetting(noteSettings,"relationTypes",values.newRelationType)))return;
   relationType=noteSettings.relationTypes.find(option=>!before.has(option.id))?.id||relationType;
  }
  pendingMediaContext=normalizeMediaContext({...values,relationType},noteSettings);
  ui.closeLayers();
  // Real reportado por el propietario: tras clasificar, el aviso decía
  // "puedes añadir una instrucción o enviarlo", pero desde el rediseño de
  // la pantalla principal (V0.21.87) el compositor fijo con el botón
  // Enviar quedó oculto y ningún paso volvía a abrirlo — la foto se
  // quedaba solo como miniatura fija en #preview, sin ninguna forma visible
  // de terminar de enviarla (ni de que desapareciera de ahí). Al abrir el
  // borrador aquí, aparece el mismo modal "Te escucho" de siempre, con su
  // "➤ Enviar" — y al enviar, clearComposer() vacía #preview como debía.
  openDraft();
  ui.notify("Adjunto clasificado. Puedes añadir una instrucción o enviarlo.")
 }})
}
// Real reportado por el propietario: hacer una foto con la cámara y luego
// añadir también fotos de la galería (o al revés) perdía en silencio lo
// elegido primero — esto sustituía pendingImages/pendingFiles entero por lo
// último elegido, en vez de sumarlo, así que la primera foto nunca llegaba
// a subirse ni a avisar de que se había perdido.
function prepareMedia(files,kind,message){if(kind==="image")pendingImages=[...pendingImages,...files];else pendingFiles=[...pendingFiles,...files];ui.showImagePreview(pendingImages);ui.notify(message);askMediaContext()}
async function saveConfirmed(nextNotes,previousNotes=notes,{waitForServer=false}={}){if(!cloud.isSignedIn()){ui.notify("Inicia sesión en Angeli antes de guardar");return false}notes=nextNotes;render();ui.setSyncStatus({state:"pending"});const syncing=cloud.syncNotes(nextNotes,previousNotes);if(waitForServer){try{await syncing;return true}catch(error){ui.setSyncStatus({state:"error",error});ui.notify("La instrucción sigue pendiente de sincronizar. Revisa Datos en Ajustes.");return false}}void syncing.catch(error=>{ui.setSyncStatus({state:"error",error});ui.notify("La instrucción sigue pendiente de sincronizar. Revisa Datos en Ajustes.")});return true}
function save(nextNotes,previousNotes=notes){void saveConfirmed(nextNotes,previousNotes);return true}
const cloud=createCloudSync({notify:ui.notify});
const google=createGoogleIntegration({notify:ui.notify,refresh:render,setStatus:ui.setGoogleStatus,showConnectionHealth:problems=>ui.showConnectionHealth(problems,{onOpenSettings:ui.openMenu}),saveNotes:save,getNotes:()=>notes,getAuthToken:cloud.getAuthToken,getSession:cloud.session,scheduleNotification:cloud.schedulePush,cancelNotification:cloud.cancelPush});
media=createMediaService({getAuthToken:cloud.getAuthToken,ensureDrive:google.ensureDrive});
// focus=true solo cuando la persona abrió el borrador tocando el compositor de
// texto (quiere escribir, el teclado ya está abierto por su toque). Desde el
// micrófono u otros flujos de voz se abre sin teclado (focus=false).
function openDraft(focus=false){ui.showDraft({value:$("text").value,focus,onInput:value=>{$("text").value=value;finalText=value;autosize()},onSend:add,onMic:()=>start({inConversation:true}),onCancel:()=>{stopStrayDictation();pendingShortcut=null;ui.closeLayers()}})}
// Una interacción solo puede continuar desde su propio popup. El compositor
// principal inicia siempre una instrucción nueva: una pregunta anterior no
// puede secuestrar órdenes posteriores como «llama a Montse».
function continueConversation(entry){ui.showInteractionQuestion(entry,{onSend:value=>{$("text").value=value;finalText=value;autosize();add({interactionId:entry.id})},onMic:()=>start({inConversation:true}),onCancel:()=>{stopStrayDictation();cancelActive(entry)}})}
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
// Reportado en la 2ª auditoría: crear/renombrar/borrar categorías y tipos de
// relación usaba prompt()/confirm() nativos, dentro de una pantalla por lo
// demás con el estilo propio de la app. Ahora usa el modal propio, igual que
// el resto (V0.22.20, V0.22.31…).
function showNoteSettings(){
 ui.showNoteSettings(noteSettings,{
  onAddCategory:()=>ui.showTextPrompt({title:"Nueva categoría",lead:"Ponle un nombre a la categoría.",placeholder:"Ej.: Salud",onCancel:showNoteSettings,onSave:label=>saveNoteSettings(addNoteSetting(noteSettings,"categories",label)).then(showNoteSettings)}),
  onAddRelation:()=>ui.showTextPrompt({title:"Nuevo tipo de relación",lead:"Ponle un nombre al tipo de relación (persona, cliente, proyecto…).",placeholder:"Ej.: Familia",onCancel:showNoteSettings,onSave:label=>saveNoteSettings(addNoteSetting(noteSettings,"relationTypes",label)).then(showNoteSettings)}),
  onAction:async(action,key,id)=>{
   const currentLabel=settingLabel(noteSettings,key,id),used=notesUsingSetting(key,id);
   if(action==="rename"){
    ui.showTextPrompt({title:"Cambiar nombre",lead:"Nuevo nombre.",value:currentLabel,onCancel:showNoteSettings,onSave:async label=>{
     ui.closeLayers();
     const nextSettings=renameNoteSetting(noteSettings,key,id,label);
     const nextNotes=notes.map(note=>{const classification=note.noteClassification||{},context=note.mediaContext||{};let next=note;if(note.type==="note"&&key==="categories"&&classification.scope===id)next={...next,noteClassification:{...classification,categoryLabel:label.trim()}};if(note.type==="note"&&key==="relationTypes"&&classification.relationType===id)next={...next,noteClassification:{...classification,relationTypeLabel:label.trim()}};if(key==="categories"&&context.scope===id)next={...next,mediaContext:{...context,categoryLabel:label.trim()}};if(key==="relationTypes"&&context.relationType===id)next={...next,mediaContext:{...context,relationTypeLabel:label.trim()}};return next});
     await saveNoteSettings(nextSettings,nextNotes);showNoteSettings();
    }});
    return;
   }
   if(action==="delete"){
    if(key==="categories"&&noteSettings.categories.length===1){ui.notify("Debe quedar al menos una categoría");return}
    const doDelete=async()=>{
     const nextSettings=removeNoteSetting(noteSettings,key,id),fallback=nextSettings.categories[0];
     const nextNotes=notes.map(note=>{const classification=note.noteClassification||{},context=note.mediaContext||{};let next=note;if(note.type==="note"&&key==="categories"&&classification.scope===id)next={...next,noteClassification:{...classification,scope:fallback.id,categoryLabel:fallback.label}};if(note.type==="note"&&key==="relationTypes"&&classification.relationType===id)next={...next,noteClassification:{...classification,relationType:"none",relationTypeLabel:"",relationName:null}};if(key==="categories"&&context.scope===id)next={...next,mediaContext:{...context,scope:fallback.id,categoryLabel:fallback.label}};if(key==="relationTypes"&&context.relationType===id)next={...next,mediaContext:{...context,relationType:"none",relationTypeLabel:"",relationName:""}};return next});
     await saveNoteSettings(nextSettings,nextNotes);showNoteSettings();
    };
    if(used.length)ui.showConfirm({title:"¿Eliminar y reasignar?",lead:`"${currentLabel}" se usa en ${used.length} nota${used.length===1?"":"s"}.`,body:key==="categories"?"Esas notas pasarán a la primera categoría.":"Esas notas quedarán sin ese tipo de relación.",confirmLabel:"Eliminar",cancelLabel:"Ahora no",onCancel:showNoteSettings,onConfirm:()=>{ui.closeLayers();doDelete()}});
    else await doDelete();
   }
  }
 });
}
async function verifyConnections(announce=true){lastConnectionCheck=Date.now();await google.syncLinks({announce});render()}
async function load(){notes=[];renderShortcuts();google.updateStatus();ui.setPushStatus(cloud.pushStatus());ui.setSyncStatus({state:"connecting"});render();await cloud.initialize({onRemoteNotes:remote=>{notes=remote;render()},onNoteSettings:remote=>{noteSettings=normalizeNoteSettings(remote||DEFAULT_NOTE_SETTINGS);render()},onNotificationSettings:remote=>{notificationSettings=normalizeNotificationSettings(remote||DEFAULT_NOTIFICATION_SETTINGS)},onNoteSettingsError:()=>ui.notify("No se pudieron cargar los ajustes de notas"),onNotificationSettingsError:()=>ui.notify("No se pudieron cargar los ajustes de avisos"),onShoppingState:remote=>{shoppingState=normalizeShoppingState(remote);if($("shoppingLibrary").classList.contains("show"))renderShoppingScreen()},onShoppingListError:()=>ui.notify("No se pudo cargar la lista de la compra"),onShortcuts:remote=>{if(remote&&Array.isArray(remote.items)){shortcuts=normalizeShortcuts(remote.items);shortcutsBaseline=shortcuts;writeShortcuts(shortcuts);shortcutsHidden=Boolean(remote.hidden);writeShortcutsHidden(shortcutsHidden);renderShortcuts()}else void cloud.saveShortcuts([],shortcuts,shortcutsHidden).then(merged=>{shortcuts=merged;shortcutsBaseline=merged;writeShortcuts(merged);renderShortcuts()}).catch(()=>{})},onShortcutsError:()=>ui.notify("No se pudieron cargar los accesos directos"),onSyncStatus:ui.setSyncStatus,onPushStatus:ui.setPushStatus,onAuthChange:async()=>{google.updateStatus();ui.setPushStatus(cloud.pushStatus());refreshOwnerUI();await verifyConnections(true)}});render();ui.dismissWelcome()}
// Base local para un acceso directo, sin pasar por la IA. routeShortcutIntent
// (en shortcuts.js) reconstruye la intención real a partir del texto con los
// parsers locales; aquí solo damos el esqueleto con la acción ya fijada. Mismos
// campos que EMPTY del intérprete, para que el resto del pipeline no note la
// diferencia. source:"shortcut" evita que se trate como respaldo de la IA caída.
function directShortcutBase(action){return{intent:action,title:null,date:null,time:null,rangeStart:null,rangeEnd:null,location:null,contactName:null,phone:null,notes:null,noteQuery:null,noteStatus:null,noteClassification:null,target:null,changes:null,linkedReminder:null,confidence:1,requiresConfirmation:false,missingFields:[],question:null,source:"shortcut",fallbackReason:null}}
async function add({interactionId=null,shortcut=null}={}){
 if(saving)return;
 const shortcutContext=shortcut||pendingShortcut,text=$("text").value.trim();
 let active=interactionId?notes.find(item=>item.id===interactionId&&item.interaction?.status==="awaiting_input")||null:null;
 // Generalización del carve-out de la lista de la compra (justo abajo) a
 // recordatorios, WhatsApp, calendario y llamadas: reportado en la auditoría
 // completa del código como el mismo fallo de raíz. Una pregunta pendiente de
 // OTRA orden (p. ej. un WhatsApp a medias esperando el nombre del contacto)
 // se comía cualquier frase nueva como si fuera su respuesta — incluido un
 // "Recuérdame llamar al médico mañana" sin relación alguna, porque
 // localWhatsApp() daba por buena cualquier texto para sus campos pendientes
 // (contactName/notes) sin comprobar si en realidad era una orden nueva de
 // otro dominio, y porque el contexto de `active` se le pasaba igualmente a
 // la IA remota (noteInterpretationContext) aunque no aplicase ninguno de los
 // respaldos locales. Si el texto trae un disparador inequívoco de orden
 // nueva de un dominio distinto al de la pregunta pendiente, se descarta
 // `active` para este turno — se procesa como si no hubiera nada a medias,
 // igual que ya hace el carve-out de la compra — en vez de arriesgarse a que
 // el pipeline (local o remoto) lo confunda con una continuación.
 if(active?.interaction?.status==="awaiting_input"){
  const overrideDomain=explicitNewCommandDomain(text);
  if(overrideDomain&&overrideDomain!==activeIntentDomain(active))active=null;
 }
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
  const shoppingCommand=parseShoppingCommand(text,shoppingState.lists.map(list=>list.name));
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
   const cancellation=(localLinked||whatsApp||noteQuery||reminderQuery||(shortcutContext?.action&&shortcutContext.action!=="calendar.delete"))?null:localCalendarCancellation(text);
   const localUpdate=(localLinked||whatsApp||noteQuery||reminderQuery||shortcutContext?.action)?null:localCalendarUpdate(text,now,active);
   const immediateCall=(localLinked||whatsApp||noteQuery||reminderQuery||cancellation||localUpdate||shortcutContext?.action)?null:localImmediateCall(text,now);
   // Acceso directo (llamar, WhatsApp, consultar/cancelar agenda): ya sabemos
   // la acción y el texto trae el dato (nombre, "hoy"…). La IA no aporta nada
   // aquí, solo latencia — routeShortcutIntent reconstruye la intención con los
   // parsers locales. Saltamos la llamada al servidor: la acción es instantánea.
   if(shortcutContext?.direct&&!active&&!hasMedia)ui.updateWorking("Preparando la acción","Angeli lo hace directo, sin esperar a la IA.","");
   const interpreted=(shortcutContext?.direct&&!active&&!hasMedia)?directShortcutBase(shortcutContext.action):await interpret(text,{provider:(value,context)=>google.interpretWithAI(value,remoteProvider,context),fallback:()=>localLinked||whatsApp||noteQuery||reminderQuery||cancellation||localUpdate||localInterpretation(text,fallbackType,active),context:noteInterpretationContext(contextFor(active),noteSettings)});
   const aiWhatsApp=interpreted.intent==="whatsapp.compose";
   // 3ª auditoría: el texto de un WhatsApp («dile que me pasa a buscar mañana a
   // las 8») ya no se lee como modificar/cancelar un evento (arriba), y un
   // WhatsApp PENDIENTE solo impone su lectura local cuando la orden trae el
   // disparador explícito, cuando la IA no respondió o cuando la IA también dice
   // WhatsApp. Si la IA, con confianza, dice que es otra cosa («tengo cita con el
   // dentista el jueves a las 5»), es una orden nueva y no el mensaje de Juan.
   const forceWhatsApp=Boolean(whatsApp)&&(aiWhatsApp||interpreted.source!=="ai"||Boolean(localWhatsApp(text,null)));
   const whatsAppInterpretation=forceWhatsApp?{...interpreted,intent:"whatsapp.compose",contactName:(aiWhatsApp?interpreted.contactName:null)||whatsApp.contactName||null,phone:(aiWhatsApp?interpreted.phone:null)||whatsApp.phone||null,notes:(aiWhatsApp?interpreted.notes:null)||whatsApp.notes||null,requiresConfirmation:true,missingFields:[],question:null}:interpreted;
   const rawInterpretation=applyExplicitNoteCategory(routeShortcutIntent(whatsAppInterpretation,shortcutContext,text,now),text,noteSettings);
   if(rawInterpretation.source==="fallback")ui.updateWorking("Estoy revisando tu petición","Necesito confirmarla contigo antes de continuar.","");
   if(rawInterpretation.fallbackReason==="quota_exhausted")ui.notify("Se agotó tu prueba de Angeli este mes. Seguiré en modo básico; pídele más a quien te dio de alta.");
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
     // Pedido explícito: "no tengo el por qué de hacer yo clic para que
     // haga la búsqueda" — antes solo se buscaba el contacto sola cuando la
     // orden venía de un acceso directo "contact.call" (el shortcut de
     // "Llamar contacto"); cualquier otra vía (hablar/escribir la orden
     // normal, o whatsapp.compose por cualquier vía) obligaba a tocar
     // "Buscar contacto" antes de poder elegir el número. Ahora se busca
     // sola en cuanto se sabe a quién, sin esperar a ningún clic — salvo
     // que el número ya se conozca (nada que buscar).
     if((interpretation.intent==="contact.call"||interpretation.intent==="whatsapp.compose")&&!entry.phone){
       ui.updateWorking("Buscando contacto","Angeli está buscando a "+(entry.contactQuery||"ese contacto")+"…","");
       await google.searchContact(entry);
     }
     ui.showEntryAction(entry,google);
   }
 }catch(error){
   // Real encontrado en auditoría: con varios adjuntos a la vez, si el
   // segundo (o el tercero...) fallaba al subir, el primero ya subido a
   // Drive nunca se borraba — esta rama solo limpiaba el estado local
   // (clearPendingMedia) sin tocar Drive, a diferencia de
   // uploadNoteAttachments, que sí deshace todo lo subido hasta el fallo.
   if(hasMedia&&!mediaUploaded){await Promise.allSettled([...images,...files].map(item=>media.remove(item.driveFileId||item.id)));clearPendingMedia();ui.closeLayers();ui.notify(error.message||"No se pudo subir el adjunto. Se ha quitado de la petición; puedes volver a elegirlo e intentarlo.");return}
   if(mediaUploaded)await Promise.allSettled([...images,...files].map(item=>media.remove(item.driveFileId||item.id)));
   ui.closeLayers();ui.notify(error.message||"No se pudo guardar la entrada");
 }finally{saving=false;setSending(false)}
}
function clearComposer(){stopStrayDictation();$("text").value="";$("text").placeholder="Escribe o dicta tu instrucción…";autosize();finalText="";pendingShortcut=null;clearPendingMedia()}
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
function stop(){dictationMic.set(false);if(rec){try{rec.stop()}catch(e){}}rec=null;setMicState(false);$("hint").textContent="Dictado terminado. Puedes continuar o pulsar Enviar cuando acabes.";autosize()}
// Real encontrado en auditoría: cancelar o guardar un borrador (el modal
// "Te escucho", la pregunta de aclaración, o los editores de campo de
// Calendar/WhatsApp) nunca paraba el reconocedor de voz si seguía
// escuchando en ese momento — se quedaba huérfano en segundo plano. El
// primer toque en OTRO micrófono (de un campo distinto, o el de modo
// conversación) entonces solo apagaba ese fantasma (start() ya se autoapaga
// si dictationMic.isActive() es true) sin llegar a arrancar nada — hacía
// falta un segundo toque, y de paso podía arrancar dos reconocedores a la
// vez si el segundo micrófono no pasaba por start(). Cualquier sitio que
// cierre un borrador, cambie de pantalla tras cancelar/guardar, o vaya a
// arrancar un reconocedor propio, debe llamar a esto primero.
function stopStrayDictation(){if(dictationMic.isActive())stop()}
function start({inConversation=false,draftId=null}={}){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(dictationMic.isActive()){stop();return}
 // Real (encontrado en revisión): con el compositor de texto ya oculto,
 // salir aquí sin abrir el borrador dejaba sin ninguna forma de escribir una
 // instrucción a quien usa un navegador sin reconocimiento de voz. El
 // borrador se abre igualmente — solo se omite arrancar el dictado — para
 // que siempre se pueda escribir a mano.
 if(!inConversation)openDraft();
 if(!SR){ui.notify("Este navegador no admite dictado; puedes escribir aquí");return}
 // Real reportado por el propietario: con continuous:false el
 // reconocedor cortaba el dictado general a los 1-3 segundos, no por una
 // pausa suya sino porque continuous:false da la sesión por terminada nada
 // más entregar un primer resultado "final" — obligaba a hablar muy rápido
 // y sin pausas, o a volver a tocar el micro para seguir. A diferencia del
 // modo conversación y del micro rápido de la compra (ahí continuous:false
 // SÍ es lo correcto: cada sesión es una sola orden de una vez), aquí se
 // dicta una instrucción/nota que puede necesitar pensar a mitad de frase,
 // así que debe seguir escuchando hasta que la persona toque el micro para
 // parar o pulse Enviar.
 const target=draftId?$(draftId):$("text");finalText=target?.value.trim()||"";const isMobileDictation=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);rec=new SR();const recognizer=rec;rec.lang="es-ES";rec.continuous=!isMobileDictation;rec.interimResults=true;rec.maxAlternatives=1;const dictationBase=finalText||"";let committed="";// Real detectado: dictar en el buscador de la lista de la compra ("café")
// no disparaba ninguna búsqueda. target.value=... asignado desde JS nunca
// emite un evento "input" nativo, así que el oninput del buscador (que es
// justamente lo que lanza la búsqueda en vivo) nunca se enteraba de que el
// texto había cambiado durante el dictado — solo funcionaba si se escribía
// a mano. Al despachar el evento manualmente, cualquier oninput ya
// existente en el campo objetivo (el de hoy y el de mañana) se entera igual
// que si la persona lo hubiera tecleado.
const paint=value=>{if(target){target.value=value;target.dispatchEvent(new Event("input",{bubbles:true}))}if(!draftId){$("text").value=value;autosize()}ui.updateDraft(value)};rec.onstart=()=>{dictationMic.set(true);setMicState(true);$("hint").textContent="Escuchando. Pulsa Enviar cuando la instrucción esté completa."};// Real reportado por el propietario: en el móvil (Chrome de Android) el dictado
// repetía palabras "como si hubiera cincuenta micros" — y confirmó que ANTES no
// pasaba, hasta que se cambió a continuous:true (que se puso para que el micro
// del ordenador no se cortara tras el primer resultado). continuous:true en
// Android está roto: encadena cada interino/final que va creciendo como
// resultados separados, y cualquier acumulación los multiplica. La solución que
// respeta ambas plataformas:
//   · Ordenador (continuous:true): una sola sesión con segmentos DISTINTOS; se
//     concatenan y se reconstruyen desde cero (idempotente).
//   · Móvil (continuous:false, como antes funcionaba): un enunciado por sesión;
//     se toma el ÚLTIMO resultado (el más completo), nunca la suma, y se REINICIA
//     el reconocedor en onend para seguir escuchando el dictado largo sin
//     cortarse — que era justo el motivo por el que se había puesto continuous.
rec.onresult=e=>{let live="";if(isMobileDictation){let finalPart="";for(let i=0;i<e.results.length;i++){const r=e.results[i],phrase=(r[0]?.transcript||"").trim();if(!phrase)continue;if(r.isFinal)finalPart=phrase;else live=phrase}if(finalPart){committed=(committed?committed+" ":"")+finalPart;live=""}}else{let finals="";for(let i=0;i<e.results.length;i++){const r=e.results[i],phrase=(r[0]?.transcript||"").trim();if(!phrase)continue;if(r.isFinal)finals+=(finals?" ":"")+phrase;else live+=(live?" ":"")+phrase}committed=finals}finalText=((dictationBase?dictationBase+" ":"")+committed).trim();paint((finalText+(live?(finalText?" ":"")+live:"")).trim())};rec.onerror=e=>{const fatal=e.error==="not-allowed"||e.error==="service-not-allowed"||e.error==="audio-capture";if(fatal){dictationMic.set(false);setMicState(false);$("hint").textContent="Dictado detenido.";ui.notify(e.error==="not-allowed"?"Permiso de micrófono denegado":"No se pudo usar el micrófono")}/* no-speech/aborted/network: sin ruido; onend decide si reinicia */};rec.onend=()=>{finalText=((dictationBase?dictationBase+" ":"")+committed).trim();paint(finalText);if(isMobileDictation&&dictationMic.isActive()&&rec===recognizer){try{recognizer.start();return}catch(_){/* si no reinicia, terminamos abajo */}}dictationMic.set(false);setMicState(false);$("hint").textContent="Dictado terminado. Puedes continuar o pulsar Enviar cuando acabes.";if(shortcutCapture&&finalText){shortcutCapture=false;createShortcut(finalText);$("text").value="";finalText=""}if(!draftId)autosize()};try{rec.start()}catch(e){dictationMic.set(false);setMicState(false);ui.notify("No se pudo iniciar el dictado")}}
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
// Real encontrado en auditoría: al guardar, siempre hacía closeLayers()
// seguido de refreshNoteLibrary() — pero refreshNoteLibrary() solo actualiza
// el HTML de una biblioteca que en ese momento está oculta (closeNoteLibrary
// ya se había llamado antes de abrir el editor), así que guardar dejaba a la
// persona en la pantalla de inicio sin ninguna confirmación de que el
// cambio se había aplicado. onSaved(updated) deja que cada sitio que llama
// a esto decida a qué pantalla volver tras guardar, igual que ya hace con
// onCancel.
function editNoteFromLibrary(entry,onCancel,onSaved){ui.showNoteEditor(entry,{settings:noteSettings,onCancel,onSave:async values=>{try{const updated=await uploadNoteAttachments(stageNoteDraft(entry,values));if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){ui.notify("Nota y adjuntos actualizados");if(onSaved)onSaved(updated);else{ui.closeLayers();refreshNoteLibrary()}}}catch(error){ui.notify(error.message||"No se pudieron subir los adjuntos")}}})}
function openNoteLibraryDetail(entry){ui.closeNoteLibrary();const show=()=>ui.showNoteDetail(entry,{onBack:()=>{ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)},onEdit:()=>editNoteFromLibrary(entry,show,updated=>{entry=updated;ui.closeLayers();show()}),onToggle:async()=>{const updated=updateNoteStatus(entry,entry.status==="done"?"pending":"done");if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){entry=updated;ui.notify(updated.status==="done"?"Nota marcada como hecha":"Nota reabierta");show()}},onDelete:()=>ui.showNoteDeleteConfirmation(entry,{onCancel:show,onConfirm:async()=>{if(await saveConfirmed(removeNoteEntry(notes,entry.id))){ui.notify("Nota borrada");ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)}}})});show()}
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
  // Real reportado por el propietario: este modal (showInteractionQuestion)
  // trae su propio cuadro de texto y su propio botón "🎙️ Hablar" — pero
  // aquí se reanudaba también el micrófono de fondo del modo conversación
  // (resumeConversationListening()) mientras ese modal seguía abierto. Con
  // los dos reconocedores de voz activos a la vez, tocar el micro del modal
  // llamaba a un SpeechRecognition nuevo mientras el de fondo ya tenía el
  // micrófono ocupado — el nuevo fallaba en silencio (rec.start() lanza
  // error si ya hay uno activo), así que hablar no escribía nada y la
  // instrucción se quedaba sin poder terminarse. Igual que en el modal
  // "manual", hay que esperar a que ESTE modal se cierre antes de reanudar
  // la escucha de fondo — el micro propio del modal es la única vía de voz
  // mientras esté abierto.
  const spoken=$("modalLead").textContent||$("modalTitle").textContent;
  ui.addConversationTurn("angeli",spoken);
  ui.setConversationStatus("Angeli está hablando…");
  await speakAloud(spoken);
  ui.setConversationStatus("Toca 🎙️ Hablar o escribe la respuesta");
  watchForModalClose(()=>{if(conversationOn)resumeConversationListening()});
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

// Pedido explícito del propietario: tocar "modo conversación" y encontrarse
// con que hay que tocar OTRA VEZ el micrófono para empezar a hablar es un
// clic de más que además confunde — si ya se ha elegido entrar en modo
// conversación, ya se sabe que se quiere hablar. El micrófono debe quedar
// escuchando en cuanto se abre la pantalla, sin ese segundo toque.
function openConversationModeReal(){
 if(!window.SpeechRecognition&&!window.webkitSpeechRecognition){ui.notify("Este navegador no admite dictado por voz");return}
 clearComposer();
 conversationOn=true;
 ui.openConversationMode();
 startConversationRecognizer();
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

async function persistShoppingState(next){
 // Comprobado en real: el enlace de "añadir tal cual" y elegir un resultado
 // de Mercadona no pasaban por runShoppingCommand (que sí exige sesión), así
 // que sin sesión decían "Añadido" aunque nunca fuera a guardarse de verdad.
 // El aviso ahora sale aquí, en el único punto por el que pasa cualquier
 // cambio a una lista.
 if(!cloud.isSignedIn()){ui.notify("Inicia sesión en Angeli antes de guardar");return false}
 shoppingState=next;
 if($("shoppingLibrary").classList.contains("show"))renderShoppingScreen();
 try{await cloud.saveShoppingState(shoppingState)}catch(_){ui.notify("La lista de la compra sigue pendiente de sincronizar")}
 return true;
}
function resolveShoppingListId(listName){
 if(!listName)return shoppingState.activeListId;
 const list=findListByName(shoppingState,listName);
 return list?list.id:shoppingState.activeListId;
}
async function addItemsToList(listId,items){
 if(!await persistShoppingState(updateListItems(shoppingState,listId,current=>addShoppingItems(current,items))))return;
 ui.notify("Añadido a la lista: "+describeShoppingItems(items));
 void linkMercadonaMatches(listId,items.filter(item=>item.store==="mercadona"));
}
// Cuando se dice "de mercadona", buscamos el producto de verdad para que
// quede su precio y su enlace — pero es un extra: si falla (red, catálogo
// caído) el artículo se queda igualmente en la lista, solo que sin producto
// vinculado. Nunca debe bloquear ni deshacer el añadido.
async function linkMercadonaMatches(listId,mercadonaItems){
 if(!mercadonaItems.length)return;
 let idToken;
 try{idToken=await cloud.getAuthToken()}catch(_){return}
 for(const addition of mercadonaItems){
  try{
   const results=await searchMercadonaProduct(addition.name,idToken);
   if(!results.length)continue;
   const list=shoppingState.lists.find(item=>item.id===listId);
   const target=list?.items.find(item=>!item.checked&&!item.product&&item.store==="mercadona"&&item.name.toLowerCase()===addition.name.toLowerCase());
   if(!target)continue;
   await persistShoppingState(updateListItems(shoppingState,listId,items=>setShoppingItemProduct(items,target.id,results[0])));
  }catch(_){/* el artículo se queda en la lista sin producto vinculado */}
 }
}
// Pedido explícitamente: como lo habitual es comprar en Mercadona, un solo
// artículo por voz/texto abre primero un modal con la búsqueda real ya
// lanzada, en vez de vincularlo en silencio por detrás. Con varios artículos
// a la vez, o si la lista NO es de Mercadona (sin catálogo de búsqueda), se
// añaden directamente, como antes.
async function runShoppingCommand(command){
 if(!cloud.isSignedIn()){ui.notify("Inicia sesión en Angeli antes de guardar");return}
 const listId=resolveShoppingListId(command.listName);
 if(command.action==="query"){openShoppingListDetail(listId);return}
 if(command.action==="clear"){await persistShoppingState(updateListItems(shoppingState,listId,items=>clearShoppingList(items)));ui.notify("Lista vaciada");return}
 if(command.action==="add"){
  // Reportado en la 2ª auditoría: al introducir "tienda por lista"
  // (V0.22.13) se gateó la búsqueda al ESCRIBIR (scheduleShoppingSearch),
  // pero no al DICTAR/ordenar por voz — aquí se comprobaba solo si el
  // artículo decía "de consum", no la tienda de la lista de destino. Añadir
  // por voz a una lista de Leroy Merlin/Carrefour lanzaba igualmente una
  // búsqueda de Mercadona que nunca podía encontrar nada. Ahora se consulta
  // la tienda real de la lista: solo Mercadona abre el modal de búsqueda.
  const targetList=shoppingState.lists.find(list=>list.id===listId);
  if(command.items.length===1&&isMercadonaList(targetList)&&command.items[0].store!=="consum"){
   openShoppingListDetail(listId);
   showShoppingAddConfirm(command.items[0],listId);
   return;
  }
  await addItemsToList(listId,command.items);
  return;
 }
 if(command.action==="remove"){await persistShoppingState(updateListItems(shoppingState,listId,items=>removeShoppingItems(items,command.items)));ui.notify("Quitado de la lista: "+describeShoppingItems(command.items));return}
 if(command.action==="check"){await persistShoppingState(updateListItems(shoppingState,listId,items=>checkShoppingItems(items,command.items,true)));ui.notify("Marcado: "+describeShoppingItems(command.items));return}
}
// "busca leche en mercadona": no exige mencionar ninguna lista, así que se
// separa de runShoppingCommand (que sí escribe la lista y por tanto exige
// sesión). Consum no tiene catálogo de productos (visto al investigar la
// API), así que se avisa en vez de intentar una búsqueda que nunca da nada.
function runShoppingSearchCommand(command){
 const listId=resolveShoppingListId(command.listName);
 openShoppingListDetail(listId);
 if(command.store==="consum"){ui.notify("Consum no tiene catálogo de productos disponible todavía; puedes añadirlo indicando la tienda igualmente");return}
 $("shoppingInput").value=command.query;
 void runShoppingSearch(command.query);
}

// ---- Varias listas con nombre (Fran, Mamá…), como en la app de Mercadona ----
function renderShoppingScreen(){
 if(shoppingView==="overview"){ui.renderShoppingOverview(shoppingState);return}
 const list=getActiveList(shoppingState);
 if(shoppingView==="cart"){ui.renderShoppingCart(list);return}
 if(shoppingView==="purchases"){ui.renderShoppingPurchases(list);return}
 ui.renderShoppingDetail(list,shoppingListTotal(list?.items||[]));
}
function openShoppingOverview(){shoppingView="overview";ui.openShoppingList();renderShoppingScreen()}
function openShoppingListDetail(listId){
 const targetId=listId||shoppingState.activeListId;
 if(targetId&&targetId!==shoppingState.activeListId){
  // 2ª auditoría: al cambiar de lista, el buscador conservaba lo escrito en
  // la lista anterior. Se limpia y se ocultan las sugerencias viejas.
  $("shoppingInput").value="";hideShoppingSuggestions();
  void persistShoppingState(setActiveShoppingList(shoppingState,targetId));
 }
 shoppingView="detail";
 ui.openShoppingList();
 renderShoppingScreen();
}
// El carrito y el historial de compras son pantallas nuevas dentro de una
// lista concreta — pedido explícito del propietario, calcado de Mercadona.
// La lista de siempre (búsqueda, agregar, etc.) no se toca en nada; estas
// dos son accesos adicionales, ya sea desde "🛒 Añadir al carrito" o desde
// el "⋮" de la lista.
function openShoppingCart(listId){
 if(listId&&listId!==shoppingState.activeListId)void persistShoppingState(setActiveShoppingList(shoppingState,listId));
 shoppingView="cart";
 ui.openShoppingList();
 renderShoppingScreen();
}
function openShoppingPurchases(listId){
 if(listId&&listId!==shoppingState.activeListId)void persistShoppingState(setActiveShoppingList(shoppingState,listId));
 shoppingView="purchases";
 ui.openShoppingList();
 renderShoppingScreen();
}
function backToShoppingOverview(){hideShoppingSuggestions();shoppingView="overview";renderShoppingScreen()}
// Desde el carrito o el historial, "volver" lleva a la lista de la que
// vinieron, no directamente a "Mis listas" — están "dentro" de esa lista.
function shoppingGoBack(){
 if(shoppingView==="cart"||shoppingView==="purchases"){shoppingView="detail";renderShoppingScreen();return}
 backToShoppingOverview();
}
// Comprobado en real: mutar shoppingView/shoppingState antes de llamar a
// persistShoppingState dejaba la vista y el estado en memoria desincronizados
// de lo que se veía en pantalla si el guardado se cortaba (p. ej. sin
// sesión) — persistShoppingState corta antes de renderizar, pero la mutación
// directa ya se había hecho igual. Ahora se calcula el estado nuevo, se
// intenta guardar, y solo si sale bien se cambia de pantalla.
// Pedido explícito del propietario: cada lista se asocia a una tienda al
// crearla, elegida entre las que él mismo compra (Mercadona, Consum, Leroy
// Merlin...) — solo Mercadona tiene catálogo real; el resto son listas de
// artículos escritos a mano, sin búsqueda en vivo ni precio.
function createShoppingListPrompt(prefillName=""){
 ui.showShoppingNamePrompt({title:"Nueva lista",lead:"Ponle un nombre — por ejemplo, Fran, Mamá o Casa.",placeholder:"Nombre de la lista",value:prefillName,confirmLabel:"Siguiente",onSave:name=>{
  // Mercadona marcada por defecto (es el 80-90% de la compra) y "Volver"
  // reabre el paso del nombre con lo ya escrito, en vez de perderlo.
  ui.showShoppingStoreChoice("mercadona",async store=>{
   if(!await persistShoppingState(createShoppingList(shoppingState,name,store)))return;
   shoppingView="detail";
   renderShoppingScreen();
  },{onBack:()=>createShoppingListPrompt(name)});
 }});
}
async function changeShoppingListStorePrompt(listId){
 const list=shoppingState.lists.find(item=>item.id===listId);
 if(!list)return;
 ui.showShoppingStoreChoice(list.store,async store=>{
  await persistShoppingState(setShoppingListStore(shoppingState,listId,store));
  renderShoppingScreen();
 });
}
function renameShoppingListPrompt(listId){
 const list=shoppingState.lists.find(item=>item.id===listId);
 if(!list)return;
 ui.showShoppingNamePrompt({title:"Cambiar nombre",lead:"Nuevo nombre para esta lista.",value:list.name,confirmLabel:"Guardar",onSave:async name=>{
  ui.closeLayers();
  await persistShoppingState(renameShoppingList(shoppingState,listId,name));
 }});
}
function deleteShoppingListPrompt(listId){
 const list=shoppingState.lists.find(item=>item.id===listId);
 if(!list)return;
 ui.showShoppingDeleteConfirm(list,{onConfirm:async()=>{
  ui.closeLayers();
  if(!await persistShoppingState(deleteShoppingList(shoppingState,listId)))return;
  shoppingView="overview";
  renderShoppingScreen();
 }});
}
function openShoppingListQuickActions(listId){
 const list=shoppingState.lists.find(item=>item.id===listId);
 if(!list)return;
 ui.openModal({title:list.name,lead:"¿Qué quieres hacer con esta lista?",actions:[
  {label:"✎ Cambiar nombre",kind:"secondary",onClick:()=>{ui.closeLayers();renameShoppingListPrompt(listId)}},
  {label:"🏬 Cambiar tienda",kind:"secondary",onClick:()=>{ui.closeLayers();changeShoppingListStorePrompt(listId)}},
  {label:"🗑️ Eliminar lista",kind:"danger",onClick:()=>{ui.closeLayers();deleteShoppingListPrompt(listId)}},
  {label:"Cancelar",kind:"secondary",onClick:ui.closeLayers}
 ]});
}
function shoppingOverviewClick(event){
 const quick=event.target.closest("[data-shopping-quick]");
 if(quick){openShoppingListQuickActions(quick.dataset.shoppingQuick);return}
 const card=event.target.closest("[data-shopping-list-id]");
 if(card)openShoppingListDetail(card.dataset.shoppingListId);
}
function shoppingItemClick(event){
 const button=event.target.closest("[data-a]");
 if(!button)return;
 const id=button.closest("[data-shopping-id]")?.dataset.shoppingId;
 if(!id)return;
 const listId=shoppingState.activeListId,action=button.dataset.a;
 if(action==="toggle")void persistShoppingState(updateListItems(shoppingState,listId,items=>toggleShoppingItem(items,id)));
 else if(action==="remove")void persistShoppingState(updateListItems(shoppingState,listId,items=>removeShoppingItemById(items,id)));
 else if(action==="qty-inc"||action==="qty-dec"){
  const item=getActiveList(shoppingState)?.items.find(entry=>entry.id===id);
  if(!item)return;
  // Fricción reportada por el propietario: bajar la cantidad a 0 se quedaba
  // clavada en 1 (setShoppingItemQuantity nunca baja de ahí) — había que
  // buscar la ✕ aparte para quitar el artículo. Igual que en cualquier
  // carrito normal, bajar de 1 quita el artículo directamente.
  if(action==="qty-dec"&&(item.quantity||1)<=1){void persistShoppingState(updateListItems(shoppingState,listId,items=>removeShoppingItemById(items,id)));return}
  void persistShoppingState(updateListItems(shoppingState,listId,items=>setShoppingItemQuantity(items,id,(item.quantity||1)+(action==="qty-inc"?1:-1))));
 }
}
function shoppingAddCheckedToCart(){
 const list=getActiveList(shoppingState);
 if(!list?.items.some(item=>item.checked)){ui.notify("Marca primero lo que quieras añadir al carrito");return}
 void persistShoppingState(addCheckedToCart(shoppingState,list.id));
 ui.notify("Añadido al carrito");
}
function shoppingCartItemClick(event){
 const button=event.target.closest("[data-a]");
 if(!button)return;
 const id=button.closest("[data-shopping-cart-id]")?.dataset.shoppingCartId;
 if(!id)return;
 const listId=shoppingState.activeListId,action=button.dataset.a;
 if(action==="cart-toggle")void persistShoppingState(toggleCartItem(shoppingState,listId,id));
 else if(action==="cart-remove")void persistShoppingState(removeCartItem(shoppingState,listId,id));
 else if(action==="cart-qty-inc"||action==="cart-qty-dec"){
  const item=getActiveList(shoppingState)?.cart?.find(entry=>entry.id===id);
  if(!item)return;
  // Mismo criterio que en la lista (ver shoppingItemClick): bajar de 1 en
  // el carrito quita el artículo directamente, en vez de quedarse clavado.
  if(action==="cart-qty-dec"&&(item.quantity||1)<=1){void persistShoppingState(removeCartItem(shoppingState,listId,id));return}
  void persistShoppingState(setCartItemQuantity(shoppingState,listId,id,(item.quantity||1)+(action==="cart-qty-inc"?1:-1)));
 }
}
function shoppingFinishPurchase(){
 const list=getActiveList(shoppingState);
 if(!list?.cart?.some(item=>item.checked)){ui.notify("Marca lo que ya has echado al carro antes de finalizar");return}
 void persistShoppingState(finalizePurchase(shoppingState,list.id));
 ui.notify("Compra guardada en el historial");
}
// Pedido explícito: poder pulsar una compra ya finalizada del historial y
// ver cada artículo con su precio y el total, no solo los nombres.
function openPurchaseDetail(purchaseId){
 const purchase=getActiveList(shoppingState)?.purchases?.find(item=>item.id===purchaseId);
 if(purchase)ui.showPurchaseDetail(purchase);
}
// Pedido explícitamente: el buscador es lo primero (como en la app de
// Mercadona) — escribir ya busca en vivo, sin botón aparte. El "+" de antes
// se sustituye por un enlace de última instancia que solo aparece cuando hay
// algo escrito, para añadir el texto tal cual si ninguna coincidencia vale.
let shoppingSearchTimer=null,shoppingSearchSeq=0,shoppingSearchResults=[];
function extractSearchQuery(value){return(parseItemList(value)[0]?.name||value).trim()}
function hideShoppingSuggestions(){shoppingSearchResults=[];ui.hideShoppingSuggestions()}
function addShoppingItemAsIs(text){
 const items=parseItemList(text);
 if(!items.length){ui.notify("Escribe algo para añadir");return}
 $("shoppingInput").value="";
 hideShoppingSuggestions();
 void addItemsToList(shoppingState.activeListId,items);
}
async function runShoppingSearch(query){
 const seq=++shoppingSearchSeq;
 ui.showShoppingSuggestionsMessage("Buscando en Mercadona…");
 if(!cloud.isSignedIn()){if(seq===shoppingSearchSeq)ui.showShoppingSuggestionsMessage("Inicia sesión en Angeli para buscar");return}
 let idToken;
 try{idToken=await cloud.getAuthToken()}catch(_){if(seq===shoppingSearchSeq)ui.showShoppingSuggestionsMessage("No se pudo buscar ahora mismo");return}
 let results=[];
 // El buscador es la vía principal para explorar de verdad ("¿cuántas
 // marcas de cerveza hay?"), no solo el primer emparejado automático —
 // pide más resultados que el límite por defecto del backend (6).
 try{results=await searchMercadonaProduct(query,idToken,20)}catch(_){results=[]}
 if(seq!==shoppingSearchSeq)return; // ya se pidió otra búsqueda mientras esta estaba en curso
 shoppingSearchResults=results;
 ui.renderShoppingSuggestions(results);
}
function scheduleShoppingSearch(){
 clearTimeout(shoppingSearchTimer);
 const raw=$("shoppingInput").value.trim(),query=extractSearchQuery(raw),mercadona=isMercadonaList(getActiveList(shoppingState));
 ui.setShoppingFallback(raw,()=>addShoppingItemAsIs(raw),{plain:!mercadona});
 // Pedido explícito del propietario: solo las listas de Mercadona tienen
 // catálogo real (searchMercadonaProduct); para el resto no hay ni API ni
 // forma de buscar, así que escribir en una lista de otra tienda solo debe
 // ofrecer añadir el artículo tal cual, sin lanzar una búsqueda que nunca
 // vas a poder responder de verdad.
 if(!mercadona){hideShoppingSuggestions();return}
 if(query.length<2){hideShoppingSuggestions();return}
 shoppingSearchTimer=setTimeout(()=>void runShoppingSearch(query),300);
}
async function selectShoppingSuggestion(index){
 const product=shoppingSearchResults[index];
 if(!product)return;
 $("shoppingInput").value="";
 hideShoppingSuggestions();
 const listId=shoppingState.activeListId;
 let next=addShoppingItems(getActiveList(shoppingState)?.items||[],[{name:product.name,store:"mercadona"}]);
 const target=next.find(item=>!item.checked&&!item.product&&item.store==="mercadona"&&item.name.toLowerCase()===product.name.toLowerCase());
 if(target)next=setShoppingItemProduct(next,target.id,product);
 if(!await persistShoppingState(updateListItems(shoppingState,listId,()=>next)))return;
 ui.notify("Añadido a la lista: "+product.name+" (mercadona)");
}
// Modal que se abre al pedir un solo artículo por voz/texto ("agrega leche a
// la lista de Fran"): la búsqueda de Mercadona ya sale lanzada con lo que se
// pidió, para elegir el producto exacto en el mismo paso en que se pidió.
// listId=null (usado por el mic de añadir rápido) significa "todavía no se
// sabe": si solo hay una lista, se añade ahí directamente; si hay varias, se
// pregunta a cuál antes de guardar — tal como se pidió explícitamente.
function showShoppingAddConfirm(addition,listId){
 const finish=item=>{
  ui.closeLayers();
  const targetId=listId||(shoppingState.lists.length<=1?shoppingState.activeListId:null);
  if(targetId){void addItemsToList(targetId,[item]);return}
  ui.showShoppingListChoice(shoppingState.lists,chosenId=>void addItemsToList(chosenId,[item]));
 };
 const openConfirmUI=()=>{
  ui.showShoppingAddConfirm({
   name:addition.name,
   onInput:query=>{clearTimeout(shoppingConfirmTimer);shoppingConfirmTimer=setTimeout(()=>void runConfirmSearch(query),300)},
   onPick:index=>{const product=shoppingConfirmResults[index];if(product)finish({name:product.name,store:"mercadona",quantity:addition.quantity,product})},
   onFallback:text=>finish({name:text||addition.name,store:addition.store,quantity:addition.quantity})
  });
 };
 const runConfirmSearch=async query=>{
  const seq=++shoppingConfirmSeq;
  ui.setShoppingConfirmStatus("Buscando en Mercadona…");
  if(!cloud.isSignedIn())return;
  let idToken;
  try{idToken=await cloud.getAuthToken()}catch(_){if(seq===shoppingConfirmSeq)ui.setShoppingConfirmStatus("No se pudo buscar ahora mismo");return}
  let results=[];
  try{results=await searchMercadonaProduct(query,idToken,8)}catch(_){results=[]}
  if(seq!==shoppingConfirmSeq)return;
  shoppingConfirmResults=results;
  ui.renderShoppingConfirmResults(results);
 };
 // Fricción reportada por el propietario: añadir un artículo siempre pedía
 // confirmar aunque el resultado fuera exacto y sin ambigüedad. Antes de
 // abrir siquiera el modal, se hace la búsqueda inicial con lo dictado/
 // escrito tal cual; si da un único resultado no hay nada que elegir — se
 // añade directamente. El modal solo se abre (ya con los resultados listos,
 // sin otro "buscando") cuando de verdad hace falta elegir entre varios, o
 // no se ha encontrado ninguno y hay que escribirlo a mano.
 void (async()=>{
  const seq=++shoppingConfirmSeq;
  if(!cloud.isSignedIn()){openConfirmUI();ui.setShoppingConfirmStatus("Inicia sesión en Angeli para buscar");return}
  let idToken;
  try{idToken=await cloud.getAuthToken()}catch(_){openConfirmUI();ui.setShoppingConfirmStatus("No se pudo buscar ahora mismo");return}
  let results=[];
  try{results=await searchMercadonaProduct(addition.name,idToken,8)}catch(_){results=[]}
  if(seq!==shoppingConfirmSeq)return;
  if(results.length===1){finish({name:results[0].name,store:"mercadona",quantity:addition.quantity,product:results[0]});return}
  shoppingConfirmResults=results;
  openConfirmUI();
  ui.renderShoppingConfirmResults(results);
 })();
}
// Mic izquierdo del hero: pedido explícitamente para un único paso — se
// dice solo el producto, y va derecho al buscador de Mercadona sin pasar
// por el intérprete general (no es una instrucción cualquiera, siempre es
// "añadir esto a la lista de la compra").
function shoppingQuickMic(){
 stopStrayDictation();
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR){ui.notify("Este navegador no admite dictado");return}
 let rec;
 try{rec=new SR()}catch(e){ui.notify("No se pudo iniciar el dictado");return}
 rec.lang="es-ES";rec.continuous=false;rec.interimResults=false;rec.maxAlternatives=1;
 rec.onstart=()=>ui.notify("Te escucho… di el producto");
 rec.onresult=event=>{
  const phrase=(event.results[0]?.[0]?.transcript||"").trim();
  if(phrase)showShoppingAddConfirm({name:phrase,store:null,quantity:1},null);
 };
 rec.onerror=event=>{if(event.error!=="no-speech")ui.notify(event.error==="not-allowed"?"Permiso de micrófono denegado":"No se pudo escuchar el micrófono")};
 try{rec.start()}catch(e){ui.notify("No se pudo iniciar el dictado")}
}
// Botón "Evento" del footer y "Calendario" de los accesos rápidos: mismo
// destino, el compositor de un evento nuevo — solo cambia el camino para
// llegar, la función es la de siempre (＋ Nuevo evento).
function openNewEventDraft(){prepareShortcut({label:"Nuevo evento",prompt:"Cuéntame el evento: fecha, hora y lugar.",prefix:"Añade al calendario ",action:"calendar.create"})}

function openDietario(){ui.openDietario(notes,dietarioState)}
function refreshDietario(){ui.renderDietario(notes,dietarioState)}
// Pedido explícito del propietario: desde el Dietario, poder añadir sin
// salir a buscar el acceso — mismo patrón que openDietarioQuickActions,
// reutilizando exactamente los mismos compositores/inputs de siempre
// (prepareShortcut, openNewEventDraft, los inputs de fotos/archivo ya
// ocultos en el footer). "La función son las mismas, no cambian."
function openDietarioAddMenu(){
 ui.openModal({title:"Añadir al dietario",lead:"¿Qué quieres añadir?",actions:[
  {label:"📅 Añadir evento",kind:"secondary",onClick:()=>{ui.closeLayers();openNewEventDraft()}},
  {label:"🔔 Añadir aviso",kind:"secondary",onClick:()=>{ui.closeLayers();prepareShortcut({label:"Recordatorio",prompt:"¿Qué quieres que te recuerde y cuándo?",prefix:"Recuérdame ",action:"reminder.create"})}},
  {label:"📝 Añadir nota",kind:"secondary",onClick:()=>{ui.closeLayers();prepareShortcut({label:"Nota",prompt:"Escribe o dicta la nota.",prefix:"",action:"note"})}},
  {label:"🖼️ Añadir imagen",kind:"secondary",onClick:()=>{ui.closeLayers();$("photoInput").click()}},
  {label:"📎 Añadir adjunto",kind:"secondary",onClick:()=>{ui.closeLayers();$("fileInput").click()}},
  {label:"Cancelar",kind:"secondary",onClick:ui.closeLayers}
 ]});
}
function openDietarioEntry(id){
 const entry=notes.find(note=>note.id===id);
 if(!entry)return;
 ui.closeDietario();
 if(entry.type==="note"){openNoteLibraryDetail(entry);return}
 if(entry.type==="photo"||entry.type==="file"){
  const item=mediaLibraryItems([entry])[0];
  if(item){openLibraryEntry(item);return}
 }
 ui.showDietarioDetail(entry,{onEdit:openDietarioCalendarMenu,onCancelEvent:cancelDietarioEvent,onCancelSchedule:cancelDietarioReminder,onDelete:deleteDietarioEntry});
}
// 2ª auditoría: abrir un evento/aviso que falló al sincronizar (o que sigue
// pendiente) desde el Dietario solo dejaba "Cerrar" — sin forma de quitarlo
// desde ahí; había que adivinar que el "⋮" de la fila era la única vía. Ahora
// la ficha ofrece siempre "🗑️ Eliminar", con confirmación.
function deleteDietarioEntry(note){
 ui.showConfirm({title:"¿Eliminar este elemento?",lead:note.aiIntent?.title||note.text||"Se quitará del Dietario.",body:"Si tiene un evento o aviso en Calendar, también se retirará de ahí. Esta acción no se puede deshacer.",confirmLabel:"Eliminar",cancelLabel:"Ahora no",onCancel:()=>openDietarioEntry(note.id),onConfirm:async()=>{ui.closeLayers();await deleteEntry(note);ui.notify("Elemento eliminado")}});
}
// Fricción reportada por el propietario: abrir un evento/aviso desde el
// Dietario solo dejaba "Cerrar" — editarlo o cancelarlo exigía ir a
// Recordatorios/Calendario aparte y volver a buscarlo. Reutiliza los mismos
// editores de campo/fecha-hora ya usados antes de confirmar (showEntryAction),
// pero aquí, al guardar, sincroniza también con Calendar por el id ya
// guardado en la entrada (google.updateSyncedCalendarEntry) en vez de solo
// actualizar el estado local — el evento ya existe de verdad en Calendar.
function openDietarioCalendarMenu(note){
 const bundled=note.proposal?.intent==="calendar.create"&&note.schedule;
 ui.openModal({title:"Modificar",lead:"Elige qué quieres cambiar. Se actualizará también en Calendar.",actions:[
  {label:"Cambiar título",kind:"secondary",onClick:()=>openDietarioCalendarFieldEditor(note,"title")},
  {label:"Cambiar fecha y hora",kind:"secondary",onClick:()=>openDietarioCalendarDateTimeEditor(note)},
  ...(bundled?[{label:"Cambiar aviso",kind:"secondary",onClick:()=>openDietarioCalendarFieldEditor(note,"reminderTitle")}]:[]),
  {label:calendarDetails(note).location?"Cambiar ubicación":"Añadir ubicación",kind:"secondary",onClick:()=>openDietarioCalendarFieldEditor(note,"location")},
  {label:calendarDetails(note).description?"Cambiar descripción":"Añadir descripción",kind:"secondary",onClick:()=>openDietarioCalendarFieldEditor(note,"description")},
  {label:"Volver",kind:"secondary",onClick:()=>openDietarioEntry(note.id)}
 ]});
}
function openDietarioCalendarFieldEditor(note,field){
 ui.showCalendarFieldEditor(note,field,{onMic:draftId=>start({inConversation:true,draftId}),onCancel:()=>{stopStrayDictation();openDietarioCalendarMenu(note)},onSave:async value=>{stopStrayDictation();const next=updateCalendarDetails(note,field,value);ui.showWorking("Actualizando","Angeli está guardando los cambios en Calendar…","");if(await google.updateSyncedCalendarEntry(next)&&await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))openDietarioEntry(next.id);else openDietarioCalendarMenu(note)}});
}
function openDietarioCalendarDateTimeEditor(note){
 ui.showCalendarDateTimeEditor(note,{onCancel:()=>{stopStrayDictation();openDietarioCalendarMenu(note)},onSave:async value=>{stopStrayDictation();const next=updateCalendarDateTime(note,value.date,value.time);ui.showWorking("Actualizando","Angeli está guardando los cambios en Calendar…","");if(await google.updateSyncedCalendarEntry(next)&&await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))openDietarioEntry(next.id);else openDietarioCalendarMenu(note)}});
}
// Reportado en la 2ª auditoría: estas dos usaban el confirm() nativo del
// navegador (feo e inconsistente con el resto de la app) y, si la
// cancelación fallaba (p. ej. token caducado), volvían a la ficha como si
// nada, con solo un aviso fugaz. Ahora confirman con el modal propio y solo
// dan por hecha la cancelación si de verdad salió bien.
async function cancelDietarioEvent(note){
 ui.openModal({title:"¿Anular este evento?",lead:"Se borrará también de Calendar.",body:"Esta acción no se puede deshacer.",actions:[
  {label:"Ahora no",kind:"secondary",onClick:()=>openDietarioEntry(note.id)},
  {label:"Anular evento",kind:"danger",onClick:async()=>{
   ui.showWorking("Anulando evento","Angeli está anulando el evento en Calendar…","");
   const ok=await google.cancelSyncedCalendarEvent(note);
   if(!ok)ui.notify("No se pudo anular el evento. Sigue activo; inténtalo de nuevo.");
   openDietarioEntry(note.id);
  }}
 ]});
}
async function cancelDietarioReminder(note){
 ui.openModal({title:"¿Cancelar este aviso?",lead:"La entrada seguirá guardada, pero ya no habrá aviso.",body:"Esta acción no se puede deshacer.",actions:[
  {label:"Ahora no",kind:"secondary",onClick:()=>openDietarioEntry(note.id)},
  {label:"Cancelar aviso",kind:"danger",onClick:async()=>{
   ui.showWorking("Cancelando aviso","Angeli está cancelando el aviso en Calendar…","");
   const ok=await google.cancelScheduledReminder(note);
   if(!ok)ui.notify("No se pudo cancelar el aviso. Sigue activo; inténtalo de nuevo.");
   openDietarioEntry(note.id);
  }}
 ]});
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
$("shoppingQuickMic").onclick=shoppingQuickMic;
$("quickNotesBtn").onclick=()=>prepareShortcut({label:"Nota",prompt:"Escribe o dicta la nota.",prefix:"",action:"note"});
$("quickRemindersBtn").onclick=()=>prepareShortcut({label:"Recordatorio",prompt:"¿Qué quieres que te recuerde y cuándo?",prefix:"Recuérdame ",action:"reminder.create"});
$("quickCalendarBtn").onclick=openNewEventDraft;
$("quickCallBtn").onclick=()=>prepareShortcut(DEFAULT_SHORTCUTS[2]);
$("quickWhatsappBtn").onclick=()=>prepareShortcut(DEFAULT_SHORTCUTS[3]);
$("quickEventBtn").onclick=openNewEventDraft;
$("clear").onclick=()=>{$("text").value="";finalText="";pendingShortcut=null;autosize();ui.notify("Borrador limpiado")};
$("contactsConnect").onclick=google.connectContacts;
$("contactsDisconnect").onclick=google.disconnectContacts;
$("calendarConnect").onclick=google.connectCalendar;
$("calendarDisconnect").onclick=google.disconnectCalendar;
$("driveConnect").onclick=google.connectDrive;
$("driveDisconnect").onclick=google.disconnectDrive;
$("aiConnect").onclick=cloud.connect;
$("aiDisconnect").onclick=cloud.disconnect;
// Panel de administrador: solo se muestra al propietario, que gestiona en vivo
// quién tiene acceso y cuánta IA gasta. El tope por defecto y el periodo mensual
// (año-mes en UTC) replican exactamente los del servidor (access_control.py).
const ADMIN_DEFAULT_LIMIT=40;
let adminUnsub=null,adminOpen=false;
function adminPeriod(){const d=new Date();return`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`}
function toAdminView(person){const mode=person.mode||"trial",status=person.status||"active";const used=person.usagePeriod===adminPeriod()?Math.max(0,Number(person.usageCount)||0):0;const limit=mode==="open"?null:(Number.isFinite(Number(person.monthlyLimit))?Number(person.monthlyLimit):ADMIN_DEFAULT_LIMIT);return{email:person.email,name:person.name||"",status,mode,limit,used}}
function refreshOwnerUI(){const owner=Boolean(cloud.session().owner);$("adminSection").hidden=!owner;if(!owner)stopAdmin()}
function stopAdmin(){if(adminUnsub){adminUnsub();adminUnsub=null}adminOpen=false}
function openAdminPanel(){
  stopAdmin();adminOpen=true;
  let people=[];
  const render=()=>{if(adminOpen)ui.showAdminPanel({people,
    onInvite:email=>cloud.saveAccessEntry(email,{name:"",status:"active",mode:"trial",monthlyLimit:ADMIN_DEFAULT_LIMIT}).then(()=>ui.notify("Invitación enviada; ya puede entrar")).catch(()=>ui.notify("No se pudo invitar")),
    onSetMode:(person,mode)=>cloud.saveAccessEntry(person.email,{mode,status:"active"}).then(()=>ui.notify(mode==="open"?"Grifo abierto":"En prueba, con tope")).catch(()=>ui.notify("No se pudo cambiar")),
    onSetStatus:(person,status)=>cloud.saveAccessEntry(person.email,{status}).then(()=>ui.notify(status==="blocked"?"Acceso cortado":"Acceso reactivado")).catch(()=>ui.notify("No se pudo cambiar")),
    onSetLimit:(person,limit)=>cloud.saveAccessEntry(person.email,{monthlyLimit:limit,mode:"trial",status:"active"}).then(()=>ui.notify("Tope actualizado")).catch(()=>ui.notify("No se pudo guardar")),
    onRemove:person=>cloud.removeAccessEntry(person.email).then(()=>ui.notify("Quitado de la lista")).catch(()=>ui.notify("No se pudo quitar")),
    onClose:stopAdmin})};
  adminUnsub=cloud.watchAccessList(list=>{people=list.map(toAdminView).sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email));render()},()=>{ui.notify("No se pudo cargar la lista de acceso");stopAdmin()});
}
$("adminPanelOpen").onclick=()=>{ui.closeLayers();openAdminPanel()};
function showNotificationSettings(){
 ui.showNotificationSettings(notificationSettings,{status:cloud.pushStatus(),onActivate:async()=>{try{await cloud.enablePush(true);ui.notify("Avisos activados en este dispositivo");showNotificationSettings()}catch(error){ui.notify(error.message||"No se pudieron activar los avisos")}},onTest:async()=>{try{const result=await cloud.testPush();ui.notify(result.delivered?"Aviso de prueba enviado":"No hay dispositivos activos")}catch(error){ui.notify(error.message||"No se pudo enviar el aviso de prueba")}},onDisable:async()=>{try{await cloud.disablePush();ui.notify("Avisos desactivados en este dispositivo");showNotificationSettings()}catch(error){ui.notify(error.message||"No se pudieron desactivar los avisos")}},onSave:async value=>{notificationSettings=normalizeNotificationSettings(value);try{await cloud.saveNotificationSettings(notificationSettings);const eligible=notes.filter(entry=>entry.schedule?.status==="scheduled"||(entry.type==="calendar"&&entry.calendarStatus==="synced")||(entry.type==="task"&&entry.status==="pending"&&entry.scheduledDate&&entry.scheduledTime));const results=await Promise.allSettled(eligible.map(entry=>cloud.schedulePush(entry))),failed=results.filter(result=>result.status==="rejected").length;if(failed){ui.notify(`Ajustes guardados, pero ${failed} aviso${failed===1?" necesita":"s necesitan"} reintento`);return}ui.closeLayers();ui.notify("Ajustes de avisos guardados")}catch(error){ui.notify(error.message||"No se pudieron guardar los ajustes")}}});
}
$("pushSettings").onclick=()=>{ui.closeLayers();showNotificationSettings()};
$("resetData").onclick=async()=>{if(!confirm("Se borrará únicamente la caché temporal de este dispositivo. Tus entradas y adjuntos seguirán en Angeli y se volverán a cargar. ¿Continuar?"))return;try{await deleteMediaDB();clearNotes();clearPendingMedia();$("text").value="";ui.notify("Caché local eliminada; tus datos siguen en Angeli")}catch(e){ui.notify("No se pudo eliminar toda la caché local")}};
$("add").onclick=add;
$("text").oninput=()=>{autosize();ui.updateDraft($("text").value)};
$("text").onfocus=()=>{if(!$("actionModal").classList.contains("show"))setTimeout(()=>{if(!$("actionModal").classList.contains("show"))openDraft(true)},120)};
$("text").onkeydown=event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();add()}};
$("galleryOpen").onclick=()=>openLibrary("image");
$("filesOpen").onclick=()=>openLibrary("file");
$("notesOpen").onclick=openNoteLibrary;
$("remindersOpen").onclick=()=>void resolveReminderQuery(localReminderQuery("Recordatorios pendientes"));
$("dietarioOpen").onclick=openDietario;
$("shoppingOpen").onclick=openShoppingOverview;
$("shoppingClose").onclick=()=>{ui.closeShoppingList();hideShoppingSuggestions()};
$("shoppingOverview").onclick=shoppingOverviewClick;
$("shoppingCreateList").onclick=createShoppingListPrompt;
$("shoppingBack").onclick=shoppingGoBack;
$("shoppingDetailMenu").onclick=()=>openShoppingListQuickActions(shoppingState.activeListId);
$("shoppingList").onclick=shoppingItemClick;
$("shoppingAddToCart").onclick=shoppingAddCheckedToCart;
$("shoppingViewCart").onclick=()=>openShoppingCart(shoppingState.activeListId);
$("shoppingViewPurchases").onclick=()=>openShoppingPurchases(shoppingState.activeListId);
$("shoppingCartList").onclick=shoppingCartItemClick;
$("shoppingFinishPurchase").onclick=shoppingFinishPurchase;
$("shoppingPurchasesList").onclick=event=>{const button=event.target.closest("[data-shopping-purchase-id]");if(button)openPurchaseDetail(button.dataset.shoppingPurchaseId)};
$("shoppingMic").onclick=()=>start({inConversation:true,draftId:"shoppingInput"});
$("shoppingInput").onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();const raw=$("shoppingInput").value.trim();if(!isMercadonaList(getActiveList(shoppingState))){addShoppingItemAsIs(raw);return}clearTimeout(shoppingSearchTimer);void runShoppingSearch(extractSearchQuery(raw))}};
$("shoppingInput").oninput=scheduleShoppingSearch;
$("shoppingSuggestions").onclick=event=>{const button=event.target.closest("[data-suggestion]");if(button)selectShoppingSuggestion(Number(button.dataset.suggestion))};
$("shoppingClearChecked").onclick=()=>{
 // Reportado en la 2ª auditoría: esto borraba los artículos marcados sin
 // confirmar, y como marcar ahora significa "lo quiero esta vez", era fácil
 // perder lo que en realidad querías pasar al carrito. Ahora se confirma.
 const marked=getActiveList(shoppingState)?.items.filter(item=>item.checked).length||0;
 if(!marked){ui.notify("No hay ningún artículo marcado");return}
 ui.showShoppingRemoveMarkedConfirm(marked,{onConfirm:()=>{ui.closeLayers();void persistShoppingState(updateListItems(shoppingState,shoppingState.activeListId,items=>clearShoppingList(items,{onlyChecked:true})))}});
};
$("shoppingClearAll").onclick=()=>{
 const list=getActiveList(shoppingState);
 if(!list?.items.length){void persistShoppingState(updateListItems(shoppingState,shoppingState.activeListId,items=>clearShoppingList(items)));return}
 ui.showShoppingClearConfirm(list,{onConfirm:()=>{ui.closeLayers();void persistShoppingState(updateListItems(shoppingState,shoppingState.activeListId,items=>clearShoppingList(items)))}});
};
$("conversationModeOpen").onclick=openConversationModeReal;
$("conversationModeClose").onclick=closeConversationModeReal;
$("conversationModeMic").onclick=toggleConversationMic;
$("dietarioAdd").onclick=openDietarioAddMenu;
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
$("noteLibraryList").onclick=event=>{const button=event.target.closest("[data-note-action]");if(!button)return;const entry=noteLibraryEntry(button.dataset.noteId);if(!entry)return;const action=button.dataset.noteAction;if(action==="open")openNoteLibraryDetail(entry);else if(action==="edit"){ui.closeNoteLibrary();const backToLibrary=()=>{ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)};editNoteFromLibrary(entry,backToLibrary,backToLibrary)}else if(action==="toggle")void(async()=>{const updated=updateNoteStatus(entry,entry.status==="done"?"pending":"done");if(await saveConfirmed(notes.map(note=>note.id===entry.id?updated:note))){ui.notify(updated.status==="done"?"Nota marcada como hecha":"Nota reabierta");refreshNoteLibrary()}})();else if(action==="delete"){ui.closeNoteLibrary();ui.showNoteDeleteConfirmation(entry,{onCancel:()=>{ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)},onConfirm:async()=>{if(await saveConfirmed(removeNoteEntry(notes,entry.id))){ui.notify("Nota borrada");ui.closeLayers();ui.openNoteLibrary(noteLibraryItems(),noteLibraryState)}}})}};
$("menuOpen").onclick=ui.openMenu;$("menuClose").onclick=ui.closeLayers;$("scrim").onclick=()=>{if(!$("actionModal").classList.contains("conversation-modal"))ui.closeLayers()};
$("clearView").onclick=()=>{if(confirm("Esto limpia solo la conversación visible. Tus entradas, fotos y archivos seguirán guardados. ¿Continuar?")){$("list").innerHTML='<div class="empty">Vista limpia. Tus datos siguen guardados.</div>';ui.notify("Vista limpiada")}};
$("shortcutManual").onclick=()=>{ui.closeLayers();pickShortcutPreset()};
$("shortcutVoice").onclick=()=>{shortcutCapture=true;$("text").value="";$("text").placeholder="Di la orden que ejecutará el acceso directo…";ui.closeLayers();start()};
$("shortcutEdit").onclick=()=>{ui.closeLayers();manageShortcuts()};
$("shortcutsToggleHide").onclick=toggleShortcutsHidden;
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
$("shortcuts").onclick=event=>{const button=event.target.closest("button");if(!button)return;if(button.id==="shortcutAdd"){pickShortcutPreset();return}const shortcut=shortcuts[Number(button.dataset.shortcut)];if(shortcut)prepareShortcut(shortcut)};
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
// 2ª auditoría: cancelar un evento encontrado en Calendar usaba el confirm()
// nativo (dentro de google.deleteCalendarEvent). La confirmación se mueve
// aquí, al modal propio de la app; solo tras aceptar se ejecuta el borrado.
function confirmCalendarEventDeletion(eventId,onConfirm){
 const localBundle=notes.some(item=>item.calendarEventId===eventId&&item.schedule?.relatedEventId===eventId&&item.schedule?.calendarEventId);
 ui.showConfirm({title:localBundle?"¿Cancelar el evento y su aviso?":"¿Cancelar este evento?",lead:localBundle?"Se cancelarán definitivamente el evento y su aviso asociado.":"Se cancelará definitivamente este evento.",body:"Esta acción no se puede deshacer.",confirmLabel:"Sí, cancelar",cancelLabel:"Ahora no",onConfirm:()=>{ui.closeLayers();onConfirm()}});
}
async function handleEntryAction(event){
 const button=event.target.closest("button");if(!button)return;
 const note=notes.find(item=>item.id===button.dataset.id);if(!note)return;
 const action=button.dataset.a;
 // 2ª auditoría: la pantalla de confirmación de un evento/aviso mostraba 5-6
 // botones "Cambiar X" antes de poder confirmarlo, aunque lo dictado
 // estuviera perfecto — un muro de botones para el caso común. Ahora esos
 // cambios se agrupan tras un solo "✎ Corregir un dato" que abre este
 // submenú; la confirmación en sí (escribir en Calendar) se mantiene, porque
 // es una acción con efecto externo que conviene revisar. Cada botón usa las
 // mismas acciones de siempre (edit-calendar-field/-datetime), así que el
 // flujo de edición no cambia; "Volver" regresa a la confirmación.
 if(action==="edit-calendar-menu"){
  const bundle=note.proposal?.intent==="calendar.create"&&note.schedule,details=calendarDetails(note);
  ui.openModal({title:"Corregir un dato",lead:"Elige qué quieres cambiar. Después vuelves a la confirmación.",actions:[
   {label:"Cambiar título",kind:"secondary",dataset:{a:"edit-calendar-field",id:note.id,field:"title"}},
   {label:"Cambiar fecha y hora",kind:"secondary",dataset:{a:"edit-calendar-datetime",id:note.id}},
   ...(bundle?[{label:"Cambiar aviso",kind:"secondary",dataset:{a:"edit-calendar-field",id:note.id,field:"reminderTitle"}}]:[]),
   {label:details.location?"Cambiar ubicación":"Añadir ubicación",kind:"secondary",dataset:{a:"edit-calendar-field",id:note.id,field:"location"}},
   {label:details.description?"Cambiar descripción":"Añadir descripción",kind:"secondary",dataset:{a:"edit-calendar-field",id:note.id,field:"description"}},
   {label:"Volver",kind:"secondary",onClick:()=>ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google)}
  ]});
  return;
 }
 if(action==="edit-calendar-field"){
  const field=button.dataset.field;
  ui.showCalendarFieldEditor(note,field,{onMic:draftId=>start({inConversation:true,draftId}),onCancel:()=>{stopStrayDictation();ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google)},onSave:async value=>{stopStrayDictation();const next=updateCalendarDetails(note,field,value);if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});
  return;
 }
 if(action==="edit-calendar-datetime"){
  ui.showCalendarDateTimeEditor(note,{onCancel:()=>{stopStrayDictation();ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google)},onSave:async value=>{stopStrayDictation();const next=updateCalendarDateTime(note,value.date,value.time);if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});
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
 if(action==="agenda-delete"){confirmCalendarEventDeletion(button.dataset.eventId,()=>cancelAgendaEvent(note,button.dataset.eventId));return}
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
 if(action==="calendar-delete"){
  confirmCalendarEventDeletion(button.dataset.eventId,async()=>{
   await google.deleteCalendarEvent(note,button.dataset.eventId);
   const current=notes.find(item=>item.id===note.id)||note;
   if(current.proposal?.actionStatus==="completed"){await saveConfirmed(markCancelledReminder(notes,button.dataset.eventId));completeCurrentAction(note.id);}
   ui.showEntryAction(notes.find(item=>item.id===note.id)||current,google);
  });
  return;
 }
 if(action==="calendar-update"){
  await google.updateCalendarEvent(note,button.dataset.eventId);
  const current=notes.find(item=>item.id===note.id)||note;
  if(current.proposal?.actionStatus==="completed")completeCurrentAction(note.id);
  ui.showEntryAction(notes.find(item=>item.id===note.id)||current,google);return;
 }
 if(action==="call"){completeCurrentAction(note.id);ui.closeLayers();window.location.href=`tel:${button.dataset.phone}`;return}
 if(action==="edit-whatsapp"){
  ui.showWhatsAppEditor(note,{onMic:draftId=>start({inConversation:true,draftId}),onCancel:()=>{stopStrayDictation();ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google)},onSave:async message=>{stopStrayDictation();const next={...note,aiIntent:{...note.aiIntent,notes:message},interaction:{...note.interaction,collectedData:{...(note.interaction?.collectedData||{}),notes:message},updatedAt:new Date().toISOString()}};if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});return;
 }
 if(action==="edit-whatsapp-phone"){
  ui.showWhatsAppPhoneEditor(button.dataset.phone?{...note,phone:button.dataset.phone}:note,{onCancel:()=>{stopStrayDictation();ui.showEntryAction(notes.find(item=>item.id===note.id)||note,google)},onSave:async phone=>{stopStrayDictation();const next={...note,phone,aiIntent:{...note.aiIntent,phone},interaction:{...note.interaction,collectedData:{...(note.interaction?.collectedData||{}),phone},updatedAt:new Date().toISOString()}};if(await saveConfirmed(notes.map(item=>item.id===note.id?next:item)))ui.showEntryAction(next,google)}});return;
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
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=0.23.5",{updateViaCache:"none"}).then(registration=>registration.update()).catch(()=>{});
load();

async function mediaServiceGet(id){return media.getMedia(id)}
function esc(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]))}
