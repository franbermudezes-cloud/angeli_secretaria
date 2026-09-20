import { typeLabel } from "./classifier.js?v=0.22.10";
import { calendarDetails, scheduleState, scheduleTitle, scheduleWhen } from "./schedule.js?v=0.22.10";
import { noteClassificationLabel, noteTitle } from "./notes.js?v=0.22.10";
import { normalizeNoteSettings, settingLabel } from "./note-settings.js?v=0.22.10";
import { whatsappChoices, whatsappPhone } from "./whatsapp.js?v=0.22.10";
import { normalizeNotificationSettings } from "./notification-settings.js?v=0.22.10";
import { filterMediaLibrary, mediaSize } from "./media-library.js?v=0.22.10";
import { mediaContextRelation, normalizeMediaContext } from "./media-context.js?v=0.22.10";
import { groupDietarioByDay } from "./dietario.js?v=0.22.10";

export function createUI({ getMedia }) {
  const $ = id => document.getElementById(id);
  let toastTimer;
  let completionTimer;
  const welcomeStartedAt = performance.now();
  let welcomeDismissed = false;
  let currentNoteSettings = normalizeNoteSettings();

  function syncVisualViewport() {
    const viewport = globalThis.window?.visualViewport;
    const root = globalThis.document?.documentElement;
    if (!viewport || !root?.style) return;
    root.style.setProperty("--angeli-viewport-height", `${viewport.height}px`);
    root.style.setProperty("--angeli-viewport-top", `${viewport.offsetTop}px`);
  }

  syncVisualViewport();
  globalThis.window?.visualViewport?.addEventListener("resize", syncVisualViewport);
  globalThis.window?.visualViewport?.addEventListener("scroll", syncVisualViewport);

  function dismissWelcome() {
    if (welcomeDismissed) return;
    welcomeDismissed = true;
    const welcome = $("welcomeScreen");
    if (!welcome) return;
    const minimumRemaining = Math.max(0, 2600 - (performance.now() - welcomeStartedAt));
    setTimeout(() => welcome.classList.add("is-leaving"), minimumRemaining);
  }

  // Un fallo de inicialización no debe dejar una pantalla de bienvenida eterna.
  setTimeout(dismissWelcome, 4500);

  function notify(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function setGoogleStatus({ contacts, calendar, drive, app }) {
    $("contactsStatus").textContent = contacts;
    $("calendarStatus").textContent = calendar;
    $("driveStatus").textContent = drive;
    $("aiStatus").textContent = app;
  }

  function setPushStatus(status = {}) {
    $("pushStatus").textContent = status.text || "Estado de avisos desconocido";
  }

  function showNotificationSettings(settings,{status,onActivate,onTest,onDisable,onSave}={}){
    const value=normalizeNotificationSettings(settings),body=document.createElement("div");body.className="notification-settings";
    body.innerHTML=`<section class="notification-device"><strong>${status?.state==="enabled"?"● Avisos activos en este dispositivo":"Avisos sin activar en este dispositivo"}</strong><div><button type="button" data-push="activate">${status?.state==="enabled"?"Renovar":"Activar"}</button><button type="button" data-push="test" ${status?.state!=="enabled"?"disabled":""}>Probar aviso</button><button type="button" data-push="disable" ${status?.state!=="enabled"?"disabled":""}>Desactivar</button></div></section><fieldset><legend>Cuándo avisar</legend><label><input type="checkbox" id="notificationAtTime" ${value.atTime?"checked":""}> A la hora indicada</label><label class="setting-number"><span>Avisar antes</span><input id="notificationBefore" type="number" min="0" max="10080" value="${value.beforeMinutes}"><span>minutos · 0 desactiva</span></label><label class="setting-number"><span>Repetir si sigue pendiente</span><input id="notificationAfter" type="number" min="0" max="10080" value="${value.afterMinutes}"><span>minutos después · 0 desactiva</span></label></fieldset><fieldset><legend>Qué quiero recibir</legend>${[["reminders","Recordatorios"],["calls","Llamadas programadas"],["linked","Avisos vinculados a eventos"],["tasks","Tareas con fecha y hora"],["events","Eventos normales de Calendar"]].map(([key,label])=>`<label><input type="checkbox" data-notification-type="${key}" ${value.types[key]?"checked":""}> ${label}</label>`).join("")}</fieldset><fieldset><legend>Horario de descanso</legend><label><input type="checkbox" id="notificationQuiet" ${value.quiet.enabled?"checked":""}> No molestar</label><div class="quiet-times"><label>Desde <input id="notificationQuietStart" type="time" value="${value.quiet.start}"></label><label>Hasta <input id="notificationQuietEnd" type="time" value="${value.quiet.end}"></label></div><label><input type="checkbox" id="notificationDeliverAfter" ${value.quiet.deliverAfter?"checked":""}> Entregar después los avisos aplazados</label></fieldset>`;
    body.onclick=event=>{const action=event.target.closest("button")?.dataset.push;if(action==="activate")onActivate?.();if(action==="test")onTest?.();if(action==="disable")onDisable?.()};
    const collect=()=>normalizeNotificationSettings({atTime:$("notificationAtTime").checked,beforeMinutes:$("notificationBefore").value,afterMinutes:$("notificationAfter").value,types:Object.fromEntries([...body.querySelectorAll("[data-notification-type]")].map(input=>[input.dataset.notificationType,input.checked])),quiet:{enabled:$("notificationQuiet").checked,start:$("notificationQuietStart").value,end:$("notificationQuietEnd").value,deliverAfter:$("notificationDeliverAfter").checked}});
    openModal({title:"Configurar avisos de Angeli",lead:"Estas reglas se aplican a tus dispositivos con avisos activos.",body,actions:[{label:"Cancelar",kind:"secondary",onClick:closeLayers},{label:"Guardar ajustes",kind:"confirm",onClick:()=>onSave?.(collect())}]});
  }

  function showConnectionHealth(problems, { onOpenSettings } = {}) {
    if (!Array.isArray(problems) || !problems.length) return;
    const body = document.createElement("div");
    body.className = "connection-health-list";
    problems.forEach(problem => {
      const row = document.createElement("div");
      row.className = `connection-health-row ${problem.state || "unavailable"}`;
      const icon = document.createElement("span");
      icon.className = "connection-health-icon";
      icon.textContent = problem.state === "unavailable" ? "?" : "!";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = problem.state === "unavailable"
        ? `No he podido comprobar ${problem.label}`
        : problem.state === "permission_required"
          ? `${problem.label} necesita permisos`
          : problem.integration === "ai"
            ? "IA no está conectada"
            : problem.integration === "contacts"
              ? "Contactos no están conectados"
              : `${problem.label} no está conectado`;
      const detail = document.createElement("span");
      detail.textContent = problem.state === "unavailable"
        ? "Puede ser un fallo temporal. Vuelve a intentarlo en unos instantes."
        : problem.integration === "ai"
          ? "Inicia de nuevo la sesión de Angeli."
          : problem.integration === "contacts"
            ? "Vuelve a conectar Contactos desde Ajustes."
            : `Vuelve a conectar ${problem.label} desde Ajustes.`;
      copy.append(title, detail);
      row.append(icon, copy);
      body.append(row);
    });
    openModal({
      title: "Revisa las conexiones",
      lead: "Angeli ha comprobado sus servicios al abrirse.",
      body,
      actions: [
        { label: "Ahora no", kind: "secondary", onClick: closeLayers },
        { label: "Abrir conexiones", kind: "confirm", onClick: () => { closeLayers(); onOpenSettings?.(); } }
      ]
    });
  }

  function setSyncStatus({ state, error } = {}) {
    const detail = error?.code === "permission-denied" ? "Firestore no autoriza esta cuenta" : error?.code === "unavailable" ? "sin conexión con Firestore" : "no se pudieron sincronizar";
    const labels = { connecting: "Datos: conectando…", pending: "Datos: guardando…", synced: "Datos: sincronizados", offline: "Datos: sin conexión; esperando red", error: "Datos: " + detail, "signed-out": "Datos: inicia sesión para verlos" };
    $("syncStatus").textContent = labels[state] || "Datos: comprobando…";
  }

  function closeLayers() {
    clearTimeout(completionTimer);
    $("actionModal").classList.remove("show");
    $("settingsMenu").classList.remove("show");
    $("scrim").classList.remove("show");
  }

  function openMenu() {
    $("scrim").classList.add("show");
    $("settingsMenu").classList.add("show");
  }

  function openModal({ title, lead, body, actions = [] }) {
    clearTimeout(completionTimer);
    $("actionModal").classList.remove("working-modal", "conversation-modal", "call-choice-modal", "completion-modal");
    $("modalTitle").textContent = title;
    $("modalLead").textContent = lead;
    const bodyElement = $("modalBody");
    bodyElement.innerHTML = "";
    if (typeof body === "string") bodyElement.innerHTML = body;
    else if (body) bodyElement.append(body);
    const actionArea = $("modalActions");
    actionArea.innerHTML = "";
    actions.forEach(action => {
      const button = document.createElement("button");
      button.textContent = action.label;
      button.className = action.kind || "secondary";
      if (action.dataset) Object.entries(action.dataset).forEach(([key, value]) => { button.dataset[key] = value; });
      if (action.onClick) button.onclick = action.onClick;
      actionArea.append(button);
    });
    $("scrim").classList.add("show");
    $("actionModal").classList.add("show");
  }

  function showDraft({ value = "", onInput, onSend, onMic, onCancel }) {
    const draft = document.createElement("textarea");
    draft.id = "activeDraft";
    draft.className = "active-draft";
    draft.rows = 5;
    draft.placeholder = "Habla o escribe aquí…";
    draft.value = value;
    draft.oninput = () => onInput?.(draft.value);
    openModal({
      title: "Te escucho",
      lead: "Puedes hablar, parar, continuar o corregir antes de enviar.",
      body: draft,
      actions: [
        { label: "Ahora no", kind: "secondary", onClick: onCancel || closeLayers },
        { label: "🎙️ Hablar", kind: "voice", onClick: () => { draft.blur(); onMic?.(); } },
        { label: "➤ Enviar", kind: "confirm", onClick: onSend }
      ]
    });
    $("actionModal").classList.add("conversation-modal");
    // Mismo ajuste que showInteractionQuestion: el propietario pidió que
    // cualquier cuadro de texto de un modal quede con el cursor puesto en
    // cuanto se abre, en vez de exigir tocarlo primero para poder escribir.
    draft.focus();
  }

  function updateDraft(value) {
    ["activeDraft", "conversationDraft", "calendarFieldDraft"].forEach(id => {
      const draft = $(id);
      if (draft && draft.value !== value) draft.value = value;
    });
  }

  function workingBody(detail) {
    const box = document.createElement("div");
    box.className = "angeli-working";
    const image = document.createElement("img");
    image.src = "assets/angeli-welcome.gif?v=0.22.10";
    image.alt = "Angeli trabajando";
    const message = document.createElement("span");
    message.id = "workingDetail";
    message.textContent = detail || "Un momento…";
    box.append(image, message);
    return box;
  }

  function showWorking(title, lead, body) {
    openModal({ title, lead, body: workingBody(body), actions: [] });
    $("actionModal").classList.add("working-modal");
  }

  function updateWorking(title, lead, body) {
    if (!$("actionModal").classList.contains("show")) return showWorking(title, lead, body);
    $("modalTitle").textContent = title;
    $("modalLead").textContent = lead;
    const detail = $("workingDetail");
    if (detail) detail.textContent = body || "Un momento…";
    else $("modalBody").replaceChildren(workingBody(body));
    $("actionModal").classList.add("working-modal");
    $("modalActions").innerHTML = "";
  }

  function showCompletion({ title, lead, body = "" }) {
    openModal({ title, lead, body, actions: [] });
    $("actionModal").classList.add("completion-modal");
    completionTimer = setTimeout(closeLayers, 1800);
  }

  function showPendingChoices(matches, { onSelect, onCancel } = {}) {
    const body = document.createElement("div");
    body.className = "contact-options";
    matches.forEach(entry => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "contact-choice";
      const title = document.createElement("strong");
      title.textContent = entry.aiIntent?.title || entry.text || "Pendiente";
      const when = document.createElement("span");
      when.textContent = entry.schedule ? scheduleWhen(entry.schedule) : "Pendiente";
      button.append(title, when);
      button.onclick = () => onSelect?.(entry);
      body.append(button);
    });
    openModal({
      title: "¿Cuál has completado?",
      lead: "He encontrado varios pendientes parecidos. Elige el correcto.",
      body,
      actions: [{ label: "Ahora no", kind: "secondary", onClick: onCancel || closeLayers }]
    });
  }

  function showReminderResults(matches, query = "", { onSelect } = {}) {
    if (!matches.length) {
      showCompletion({
        title: "No hay recordatorios pendientes",
        lead: query ? `No encuentro ninguno relacionado con ${query}.` : "No tienes recordatorios pendientes."
      });
      return;
    }
    const body = document.createElement("div");
    body.className = "contact-options";
    matches.forEach(entry => {
      const item = document.createElement("button");
      item.type = "button"; item.onclick = () => onSelect?.(entry);
      item.className = "contact-choice manager-row";
      const title = document.createElement("strong");
      title.textContent = entry.aiIntent?.title || entry.text || "Recordatorio";
      const when = document.createElement("span");
      when.textContent = (entry.schedule ? scheduleWhen(entry.schedule) : "Sin fecha") + " · " + (entry.status === "done" ? "Hecho" : "Pendiente");
      item.append(title, when);
      body.append(item);
    });
    openModal({
      title: matches.length === 1 ? "Tienes este recordatorio" : "Tienes estos recordatorios",
      lead: query ? `Pendientes relacionados con ${query}.` : "Estos son tus recordatorios pendientes.",
      body,
      actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }]
    });
  }

  function showReminderDetail(entry,{onEdit,onComplete,onCancel,onBack}={}){
    const details=calendarDetails(entry),body='<div class="manager-detail">'+calendarCard(entry)+'<span class="manager-status pending">'+esc(scheduleState(entry.schedule))+'</span></div>';
    openModal({title:details.title,lead:"Ficha del recordatorio",body,actions:[
      {label:"Volver",kind:"secondary",onClick:onBack},
      {label:"Modificar",kind:"secondary",onClick:()=>onEdit?.(entry)},
      {label:"✓ Hecho",kind:"confirm",onClick:()=>onComplete?.(entry)},
      {label:"Cancelar aviso",kind:"danger",onClick:()=>onCancel?.(entry)}
    ]});
  }
  function showReminderEditor(entry,{onSave,onCancel}={}){
    const details=calendarDetails(entry),due=entry.schedule?.dueAt||"";
    const form=document.createElement("div");form.className="record-editor";
    form.innerHTML='<label>Título<input id="reminderEditTitle" type="text"></label><label>Fecha<input id="reminderEditDate" type="date"></label><label>Hora<input id="reminderEditTime" type="time"></label><label>Ubicación<input id="reminderEditLocation" type="text"></label><label>Descripción<textarea id="reminderEditDescription" rows="3"></textarea></label>';
    openModal({title:"Modificar recordatorio",lead:"Corrige cualquier dato y guardaré el cambio también en Calendar.",body:form,actions:[{label:"Volver",kind:"secondary",onClick:onCancel},{label:"Guardar cambios",kind:"confirm",onClick:()=>{const date=$("reminderEditDate").value,time=$("reminderEditTime").value;if(!date||!time)return notify("Indica la fecha y la hora");onSave?.({title:$("reminderEditTitle").value.trim(),date,time,location:$("reminderEditLocation").value.trim(),description:$("reminderEditDescription").value.trim()})}}]});
    $("reminderEditTitle").value=details.title;$("reminderEditDate").value=due.slice(0,10)||entry.scheduledDate||"";$("reminderEditTime").value=due.slice(11,16)||entry.scheduledTime||"";$("reminderEditLocation").value=details.location||"";$("reminderEditDescription").value=details.description||"";
  }

  function showReminderCancellation(entry) {
    openModal({
      title: "¿Cancelar este recordatorio?",
      lead: `${scheduleTitle(entry)}${entry.schedule ? " · " + scheduleWhen(entry.schedule) : ""}`,
      body: "Solo se cancelará el recordatorio seleccionado.",
      actions: [
        { label: "Ahora no", kind: "secondary", onClick: closeLayers },
        { label: "Cancelar recordatorio", kind: "danger", dataset: { a: "cancel-schedule", id: entry.id } }
      ]
    });
  }

  function showNoteResults(matches, query = "", { status = "pending", onOpen, onEdit, onToggle, onDelete } = {}) {
    if (!matches.length) {
      showCompletion({ title: "No encuentro esas notas", lead: query ? `No hay notas relacionadas con ${query}.` : "Todavía no tienes notas guardadas." });
      return;
    }
    const body = document.createElement("div");
    body.className = "contact-options note-results";
    matches.forEach(entry => {
      const item = document.createElement("div");
      item.className = "contact-choice note-result";
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = noteTitle(entry);
      const detail = document.createElement("span");
      detail.textContent = noteClassificationLabel(entry.noteClassification);
      const text = document.createElement("p");
      text.textContent = entry.text || "";
      content.append(title, detail, text);
      const actions = document.createElement("div");
      actions.className = "inline-actions note-result-actions";
      const open = document.createElement("button"); open.className = "small-btn primary"; open.textContent = "Abrir ficha"; open.onclick = () => onOpen?.(entry);
      const edit = document.createElement("button"); edit.className = "small-btn"; edit.textContent = "Editar"; edit.onclick = () => onEdit?.(entry);
      const toggle = document.createElement("button"); toggle.className = "small-btn"; toggle.textContent = entry.status === "done" ? "Reabrir" : "✓ Hecho"; toggle.onclick = () => onToggle?.(entry);
      const remove = document.createElement("button"); remove.className = "small-btn danger"; remove.textContent = "Borrar"; remove.onclick = () => onDelete?.(entry);
      actions.append(open,edit, toggle, remove);
      item.append(content, actions);
      body.append(item);
    });
    const group = status === "done" ? "hechas" : status === "all" ? "guardadas" : "pendientes";
    openModal({ title: matches.length === 1 ? "He encontrado esta nota" : "He encontrado estas notas", lead: query ? `Relacionadas con ${query}.` : `Estas son tus notas ${group}.`, body, actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
  }

  function showNoteDetail(note,{onEdit,onToggle,onDelete,onBack}={}){
    const state=note.status==="done"?"Hecha":"Pendiente";
    openModal({title:noteTitle(note),lead:`Ficha de nota · ${state}`,body:noteConfirmationCard(note)+`<span class="manager-status ${note.status==="done"?"done":"pending"}">${state}</span>`,actions:[
      {label:"Volver",kind:"secondary",onClick:onBack},
      {label:"Editar",kind:"secondary",onClick:()=>onEdit?.(note)},
      {label:note.status==="done"?"Reabrir":"✓ Hecha",kind:"confirm",onClick:()=>onToggle?.(note)},
      {label:"Borrar",kind:"danger",onClick:()=>onDelete?.(note)}
    ]});
  }

  function showNoteDeleteConfirmation(note, { onConfirm, onCancel } = {}) {
    let deleting = false;
    const confirmOnce = async () => {
      if (deleting) return;
      deleting = true;
      try { await onConfirm?.(); }
      finally { deleting = false; }
    };
    openModal({ title: "¿Borro esta nota?", lead: "Se eliminará de Angeli en todos tus dispositivos.", body: noteConfirmationCard(note), actions: [
      { label: "Volver", kind: "secondary", onClick: onCancel },
      { label: "Borrar definitivamente", kind: "danger", onClick: confirmOnce }
    ] });
  }

  function noteConfirmationCard(note, settings = currentNoteSettings) {
    const classification = note.noteClassification || note.aiIntent?.noteClassification || {};
    const relation = classification.relationName ? '<span class="calendar-field-label">Relacionada con</span><b>' + esc(classification.relationName) + '</b>' : '';
    const purpose = classification.purpose ? '<span class="calendar-field-label">Motivo</span><b>' + esc(classification.purpose) + '</b>' : '';
    const tags = classification.tags?.length ? '<span class="calendar-field-label">Etiquetas</span><b>' + esc(classification.tags.join(" · ")) + '</b>' : '';
    const category = settingLabel(settings, "categories", classification.scope, classification.categoryLabel || noteClassificationLabel(classification));
    const relationType = classification.relationType !== "none" ? settingLabel(settings, "relationTypes", classification.relationType, classification.relationTypeLabel) : "";
    const relationLabel = relationType && classification.relationName ? `${relationType}: ${classification.relationName}` : classification.relationName || "";
    const attachments = [...(note.images || []), ...(note.files || []), ...(note._pendingImages || []), ...(note._pendingFiles || [])];
    const attachmentNames = attachments.map((item,index) => typeof item === "string" ? `Adjunto ${index + 1}` : item.name || `Adjunto ${index + 1}`);
    const attachmentRow = attachmentNames.length ? '<span class="calendar-field-label">Adjuntos</span><b>' + esc(attachmentNames.join(" · ")) + '</b>' : '';
    return '<div class="calendar-confirmation note-confirmation"><span class="calendar-field-label">Título</span><strong>' + esc(noteTitle(note)) + '</strong><span class="calendar-field-label">Contenido</span><b>' + esc(note.text) + '</b><span class="calendar-field-label">Categoría</span><b>' + esc(category) + '</b>' + (relationLabel ? '<span class="calendar-field-label">Relacionada con</span><b>' + esc(relationLabel) + '</b>' : '') + purpose + tags + attachmentRow + '</div>';
  }

  function showNoteConfirmation(note, { settings = currentNoteSettings, onSave, onEdit, onCancel } = {}) {
    openModal({
      title: "¿Guardo esta nota?",
      lead: "Comprueba el contenido y su clasificación. Nada se guardará hasta que confirmes.",
      body: noteConfirmationCard(note, settings),
      actions: [
        { label: "Cancelar", kind: "secondary", onClick: onCancel || closeLayers },
        { label: "Modificar", kind: "secondary", onClick: onEdit },
        { label: "Guardar nota", kind: "confirm", onClick: onSave }
      ]
    });
  }

  function showNoteEditor(note, { settings = currentNoteSettings, missingFields = [], onSave, onCancel } = {}) {
    const classification = note.noteClassification || note.aiIntent?.noteClassification || {};
    const normalizedSettings = normalizeNoteSettings(settings);
    const form = document.createElement("div");
    form.className = "note-editor";
    form.innerHTML = '<label>Título<input id="noteDraftTitle" type="text"></label>' +
      '<label>Contenido<textarea id="noteDraftText" rows="4"></textarea></label>' +
      '<label>Categoría<select id="noteDraftScope">' + normalizedSettings.categories.map(option => '<option value="' + esc(option.id) + '">' + esc(option.label) + '</option>').join("") + '</select></label>' +
      '<label>Relación<select id="noteDraftRelationType"><option value="none">Sin relación</option>' + normalizedSettings.relationTypes.map(option => '<option value="' + esc(option.id) + '">' + esc(option.label) + '</option>').join("") + '</select></label>' +
      '<label>Nombre relacionado<input id="noteDraftRelationName" type="text" placeholder="Persona, cliente, proyecto o evento"></label>' +
      '<label>Motivo<input id="noteDraftPurpose" type="text"></label>' +
      '<label>Etiquetas<input id="noteDraftTags" type="text" placeholder="Separadas por comas"></label>' +
      '<div class="note-attachment-picker"><strong>Adjuntos</strong><div id="noteDraftAttachments" class="media-context-files"></div><div class="note-attachment-actions"><label>🖼️ Añadir foto<input id="noteDraftImages" type="file" accept="image/*" multiple hidden></label><label>📎 Añadir archivo<input id="noteDraftFiles" type="file" multiple hidden></label></div></div>';
    let newImages = [...(note._pendingImages || [])], newFiles = [...(note._pendingFiles || [])];
    const paintAttachments = () => {
      const existing = [...(note.images || []), ...(note.files || [])].map((item,index) => typeof item === "string" ? `Adjunto ${index + 1}` : item.name || `Adjunto ${index + 1}`);
      $("noteDraftAttachments").innerHTML = [...existing, ...newImages.map(file => file.name), ...newFiles.map(file => file.name)].map(name => `<span>📎 ${esc(name)}</span>`).join("") || '<span>Sin adjuntos</span>';
    };
    openModal({
      title: missingFields.length ? "Completar nota" : "Modificar nota",
      lead: missingFields.includes("text") ? "¿Qué quieres guardar en esta nota? Añade el contenido y un título breve." : missingFields.includes("title") ? "¿Qué título quieres ponerle a esta nota? El contenido ya está preparado." : "Corrige únicamente lo que necesites y vuelve a revisar la ficha.",
      body: form,
      actions: [
        { label: missingFields.length ? "Cancelar" : "Volver", kind: "secondary", onClick: onCancel },
        { label: "Revisar cambios", kind: "confirm", onClick: () => {
          for (const id of ["noteDraftTitle", "noteDraftText"]) {
            if (!$(id).value.trim()) { notify(id === "noteDraftTitle" ? "Escribe un título para la nota" : "Escribe el contenido de la nota"); $(id).focus(); return; }
          }
          onSave?.({
          title: $("noteDraftTitle").value,
          text: $("noteDraftText").value,
          scope: $("noteDraftScope").value,
          categoryLabel: settingLabel(normalizedSettings, "categories", $("noteDraftScope").value),
          relationType: $("noteDraftRelationType").value,
          relationTypeLabel: settingLabel(normalizedSettings, "relationTypes", $("noteDraftRelationType").value),
          relationName: $("noteDraftRelationName").value,
          purpose: $("noteDraftPurpose").value,
          tags: $("noteDraftTags").value,
          images: newImages,
          files: newFiles
        }); } }
      ]
    });
    $("noteDraftTitle").value = missingFields.includes("title") ? "" : noteTitle(note);
    $("noteDraftText").value = note.text || "";
    $("noteDraftScope").value = classification.scope || "general";
    $("noteDraftRelationType").value = classification.relationType || "none";
    $("noteDraftRelationName").value = classification.relationName || "";
    $("noteDraftPurpose").value = classification.purpose || "";
    $("noteDraftTags").value = (classification.tags || []).join(", ");
    $("noteDraftImages").onchange = event => { newImages = [...newImages, ...event.target.files]; paintAttachments(); };
    $("noteDraftFiles").onchange = event => { newFiles = [...newFiles, ...event.target.files]; paintAttachments(); };
    paintAttachments();
  }

  function showNoteSettings(settings, { onAction, onAddCategory, onAddRelation } = {}) {
    const normalized = normalizeNoteSettings(settings);
    const rows = (key, options) => options.map(option => '<div class="note-setting-row"><strong>' + esc(option.label) + '</strong><span><button class="small-btn" data-note-setting-action="rename" data-note-setting-key="' + key + '" data-note-setting-id="' + esc(option.id) + '">Renombrar</button><button class="small-btn danger" data-note-setting-action="delete" data-note-setting-key="' + key + '" data-note-setting-id="' + esc(option.id) + '">Borrar</button></span></div>').join("") || '<p class="menu-copy">No hay opciones configuradas.</p>';
    const body = document.createElement("div");
    body.className = "note-settings-panel";
    body.innerHTML = '<h3>Categorías</h3>' + rows("categories", normalized.categories) + '<h3>Tipos de relación</h3>' + rows("relationTypes", normalized.relationTypes);
    body.onclick = event => {
      const button = event.target.closest("button[data-note-setting-action]");
      if (button) onAction?.(button.dataset.noteSettingAction, button.dataset.noteSettingKey, button.dataset.noteSettingId);
    };
    openModal({ title: "Ajustes de notas", lead: "Estas opciones se sincronizan entre tus dispositivos.", body, actions: [
      { label: "＋ Categoría", kind: "secondary", onClick: onAddCategory },
      { label: "＋ Relación", kind: "secondary", onClick: onAddRelation },
      { label: "Cerrar", kind: "confirm", onClick: closeLayers }
    ] });
  }

  // Pedido explícito del propietario: al clasificar un adjunto puede hacer
  // falta un tipo de relación que todavía no existe en Ajustes (p. ej.
  // "familia") — antes solo se podían elegir los ya configurados, y crear
  // uno nuevo exigía salir a Ajustes primero. La opción "+ Nuevo tipo…"
  // deja escribirlo aquí mismo, en el momento de subir el adjunto; app.js
  // lo crea de verdad en los ajustes de notas antes de guardar el adjunto.
  function showMediaContextEditor({ files = [], context = {}, settings = currentNoteSettings, onSave, onCancel } = {}) {
    const normalizedSettings = normalizeNoteSettings(settings);
    const current = normalizeMediaContext(context, normalizedSettings);
    const form = document.createElement("div");
    form.className = "note-editor media-context-editor";
    form.innerHTML = '<div class="media-context-files">' + files.map(name => '<span>📎 ' + esc(name) + '</span>').join("") + '</div>' +
      '<label>¿Para qué lo guardas?<textarea id="mediaContextPurpose" rows="3" placeholder="Ej.: Presupuesto de la reforma del local"></textarea></label>' +
      '<label>Categoría<select id="mediaContextScope">' + normalizedSettings.categories.map(option => '<option value="' + esc(option.id) + '">' + esc(option.label) + '</option>').join("") + '</select></label>' +
      '<label>Relacionado con<select id="mediaContextRelationType"><option value="none">Sin relación</option>' + normalizedSettings.relationTypes.map(option => '<option value="' + esc(option.id) + '">' + esc(option.label) + '</option>').join("") + '<option value="__new__">+ Nuevo tipo…</option></select></label>' +
      '<label id="mediaContextRelationTypeNewRow" class="hidden">Nombre del nuevo tipo<input id="mediaContextRelationTypeNew" type="text" placeholder="Ej.: Familia"></label>' +
      '<label id="mediaContextRelationRow">Nombre relacionado<input id="mediaContextRelationName" type="text" placeholder="Persona, cliente, proyecto o evento"></label>';
    const toggleRelation = () => {
      const isNew = $("mediaContextRelationType").value === "__new__";
      $("mediaContextRelationTypeNewRow").classList.toggle("hidden", !isNew);
      $("mediaContextRelationRow").classList.toggle("hidden", $("mediaContextRelationType").value === "none");
    };
    openModal({ title: "Organizar adjunto", lead: "Indica por qué lo guardas para poder encontrarlo después.", body: form, actions: [
      { label: "Quitar adjunto", kind: "secondary", onClick: () => { closeLayers(); onCancel?.(); } },
      { label: "Continuar", kind: "confirm", onClick: () => {
        const purpose = $("mediaContextPurpose").value.trim(), relationType = $("mediaContextRelationType").value, relationName = $("mediaContextRelationName").value.trim(), newRelationType = $("mediaContextRelationTypeNew").value.trim();
        if (!purpose) { notify("Explica brevemente para qué guardas este adjunto"); $("mediaContextPurpose").focus(); return; }
        if (relationType === "__new__" && !newRelationType) { notify("Escribe el nombre del nuevo tipo de relación"); $("mediaContextRelationTypeNew").focus(); return; }
        if (relationType !== "none" && !relationName) { notify("Indica con quién o con qué está relacionado"); $("mediaContextRelationName").focus(); return; }
        onSave?.({ purpose, scope: $("mediaContextScope").value, relationType, relationName, ...(relationType === "__new__" ? { newRelationType } : {}) });
      } }
    ] });
    $("mediaContextPurpose").value = current.purpose;
    $("mediaContextScope").value = current.scope;
    $("mediaContextRelationType").value = current.relationType;
    $("mediaContextRelationName").value = current.relationName;
    $("mediaContextRelationType").onchange = toggleRelation;
    toggleRelation();
  }

  function entryBody(note) {
    const description = note.proposal?.description || "Entrada guardada";
    const location = note.location ? "<br>📍 " + esc(note.location) : "";
    return '<div class="proposal-box"><strong>' + esc(typeLabel(note.type)) + "</strong>" + esc(description) + location + "</div>" + mediaContextCard(note);
  }

  function mediaContextCard(note) {
    const context = note.mediaContext;
    if (!context) return "";
    const relation = mediaContextRelation(context);
    return '<div class="calendar-confirmation media-context-card"><span class="calendar-field-label">Motivo</span><strong>' + esc(context.purpose) + '</strong><span class="calendar-field-label">Categoría</span><b>' + esc(context.categoryLabel || context.scope) + '</b>' + (relation ? '<span class="calendar-field-label">Relacionado con</span><b>' + esc(relation) + '</b>' : '') + '</div>';
  }

  function calendarCard(note) {
    const details = calendarDetails(note);
    return '<div class="calendar-confirmation">' +
      '<span class="calendar-field-label">Título que guardaré</span><strong>' + esc(details.title) + '</strong>' +
      '<span class="calendar-field-label">Fecha y hora</span><b>' + esc(details.when) + '</b>' +
      '<span class="calendar-field-label">Ubicación</span><b>' + (details.location ? '📍 ' + esc(details.location) : 'Sin ubicación') + '</b>' +
      '<span class="calendar-field-label">Descripción</span><b>' + (details.description ? esc(details.description) : 'Sin descripción') + '</b></div>';
  }

  function showEntryAction(note, google) {
    const intent = note.proposal?.intent || "note";
    const base = { title: "Entrada preparada", lead: "Angeli ha entendido esto. Confirma solo si quieres realizar la acción.", body: entryBody(note) };
    if (intent === "note") {
      showCompletion({ title: "✓ Nota guardada", lead: "Ya está sincronizada y clasificada.", body: noteConfirmationCard(note) });
      return;
    }
    if (intent === "calendar.create" && note.schedule) {
      const reminder = '<div class="calendar-confirmation"><span class="calendar-field-label">Aviso vinculado</span><strong>⏰ ' + esc(scheduleTitle(note)) + '</strong><span class="calendar-field-label">Fecha y hora del aviso</span><b>' + esc(scheduleWhen(note.schedule)) + '</b></div>';
      const completed = note.calendarStatus === "synced" && note.schedule.status === "scheduled";
      if (completed) {
        const links = (note.calendarUrl ? '<a href="' + esc(note.calendarUrl) + '" target="_blank" rel="noopener">Abrir evento</a>' : '') + (note.schedule.calendarUrl ? ' · <a href="' + esc(note.schedule.calendarUrl) + '" target="_blank" rel="noopener">Abrir aviso</a>' : '');
        showCompletion({ title: "✓ Evento y aviso creados", lead: "Los dos elementos relacionados ya están en Calendar.", body: entryBody(note) + calendarCard(note) + reminder + (links ? '<p>' + links + '</p>' : '') });
        return;
      }
      openModal({ ...base, title: note.calendarStatus === "error" ? "No se pudo completar" : "¿Creo el evento y su aviso?", lead: "Comprueba los dos elementos. Se guardarán juntos o no se guardará ninguno.", body: entryBody(note) + calendarCard(note) + reminder, actions: [
        { label: "Cancelar", kind: "secondary", onClick: closeLayers },
        { label: "Cambiar título", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "title" } },
        { label: "Cambiar fecha y hora", kind: "secondary", dataset: { a: "edit-calendar-datetime", id: note.id } },
        { label: "Cambiar aviso", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "reminderTitle" } },
        { label: calendarDetails(note).location ? "Cambiar ubicación" : "Añadir ubicación", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "location" } },
        { label: calendarDetails(note).description ? "Cambiar descripción" : "Añadir descripción", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "description" } },
        { label: note.calendarStatus === "error" ? "Reintentar" : "📅 Crear los dos", kind: "confirm", dataset: { a: "calendar-bundle", id: note.id } }
      ] });
      return;
    }
    if (note.schedule) {
      const detail = entryBody(note) + calendarCard(note) + '<div class="schedule-box"><small>Estado: ' + esc(scheduleState(note.schedule)) + '</small></div>';
      if (note.schedule.status === "scheduled") {
        const link = note.schedule.calendarUrl ? '<p><a href="' + esc(note.schedule.calendarUrl) + '" target="_blank" rel="noopener">Abrir aviso en Calendar</a></p>' : "";
        showCompletion({ title: "✓ Aviso programado", lead: "Calendar te avisará a la hora indicada.", body: detail + link });
        return;
      }
      if (note.schedule.status === "cancelled") {
        showCompletion({ title: "Aviso cancelado", lead: "La entrada sigue guardada, pero ya no habrá aviso.", body: detail });
        return;
      }
      if (note.schedule.status === "completed") {
        showCompletion({ title: "✓ Pendiente completado", lead: "Lo he marcado como hecho.", body: detail });
        return;
      }
      openModal({ ...base, title: note.schedule.status === "error" ? "No se pudo programar" : "¿Programo este aviso?", lead: "Comprueba el título. Si está bien, solo tienes que programarlo.", body: detail, actions: [{ label: "Cancelar", kind: "secondary", onClick: closeLayers }, { label: "Cambiar título", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "title" } }, { label: "Cambiar fecha y hora", kind: "secondary", dataset: { a: "edit-calendar-datetime", id: note.id } }, { label: calendarDetails(note).location ? "Cambiar ubicación" : "Añadir ubicación", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "location" } }, { label: calendarDetails(note).description ? "Cambiar descripción" : "Añadir descripción", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "description" } }, { label: note.schedule.status === "error" ? "Reintentar" : "⏰ Programar", kind: "confirm", dataset: { a: "schedule", id: note.id } }] });
      return;
    }
    if (intent === "calendar.create") {
      if (note.calendarStatus === "synced") {
        const link = note.calendarUrl ? '<p><a href="' + esc(note.calendarUrl) + '" target="_blank" rel="noopener">Abrir evento en Calendar</a></p>' : "";
        showCompletion({ title: "✓ Añadido al calendario", lead: "El evento ya está creado.", body: entryBody(note) + link });
        return;
      }
      openModal({ ...base, title: "¿Lo añado al calendario?", lead: "Comprueba el título. La ubicación y la descripción se guardarán en sus campos.", body: entryBody(note) + calendarCard(note), actions: [
        { label: "Cancelar", kind: "secondary", onClick: closeLayers },
        { label: "Cambiar título", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "title" } },
        { label: "Cambiar fecha y hora", kind: "secondary", dataset: { a: "edit-calendar-datetime", id: note.id } },
        { label: calendarDetails(note).location ? "Cambiar ubicación" : "Añadir ubicación", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "location" } },
        { label: calendarDetails(note).description ? "Cambiar descripción" : "Añadir descripción", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "description" } },
        { label: "📅 Añadir", kind: "confirm", dataset: { a: "calendar", id: note.id } }
      ] });
      return;
    }
    if (intent === "whatsapp.compose") {
      const result = !note.phone && google ? google.getContactResult(note.id) : null;
      const allPhones = whatsappChoices(note, result);
      const choices = allPhones.filter(item => whatsappPhone(item.phone));
      // Hallazgo de la auditoría completa: un contacto con un móvil en
      // formato no reconocido (sin "+"/"00" y sin encajar en el patrón
      // español de 9 cifras — p. ej. un número extranjero guardado tal cual)
      // hacía que whatsappPhone lo descartara en silencio, y esta pantalla
      // mostraba "No encuentro un móvil" como si Contactos no tuviera
      // ninguno, en vez de mostrar el número real para que solo haga falta
      // añadirle el prefijo.
      const rawChoices = allPhones.filter(item => !whatsappPhone(item.phone));
      const message = '<div class="calendar-confirmation"><span class="calendar-field-label">Destinatario</span><strong>' + esc(note.contactQuery || note.aiIntent?.contactName || "Sin destinatario") + '</strong><span class="calendar-field-label">Mensaje preparado</span><b>' + esc(note.aiIntent?.notes || "Sin mensaje") + '</b></div>';
      if (result?.error) {
        openModal({ ...base, title: "No puedo consultar Contactos", lead: result.error, body: message, actions: [{ label: "Cerrar", kind: "secondary", onClick: closeLayers }] });
        return;
      }
      if (result && !choices.length && !rawChoices.length) {
        openModal({ ...base, title: "No encuentro un móvil", lead: "Puedes indicar otro número con prefijo internacional.", body: message, actions: [{ label: "Cambiar mensaje", kind: "secondary", dataset:{a:"edit-whatsapp",id:note.id} }, { label: "Indicar número", kind: "confirm", dataset:{a:"edit-whatsapp-phone",id:note.id} }, { label: "Cerrar", kind: "secondary", onClick: closeLayers }] });
        return;
      }
      if (result && !choices.length && rawChoices.length) {
        const rawNumbers = rawChoices.map(item => '<button class="contact-choice" data-a="edit-whatsapp-phone" data-id="' + esc(note.id) + '" data-phone="' + esc(item.phone) + '"><strong>💬 ' + esc(item.name) + '</strong><span>' + esc(item.phone) + '</span></button>').join("");
        openModal({ ...base, title: "Revisa el número", lead: "Encontré este número pero le falta el prefijo internacional.", body: message + '<div class="contact-options">' + rawNumbers + '</div>', actions: [{ label: "Cambiar mensaje", kind: "secondary", dataset:{a:"edit-whatsapp",id:note.id} }, { label: "Indicar número", kind: "confirm", dataset:{a:"edit-whatsapp-phone",id:note.id} }, { label: "Cerrar", kind: "secondary", onClick: closeLayers }] });
        return;
      }
      const numbers = choices.map(item => '<button class="contact-choice" data-a="open-whatsapp" data-id="' + esc(note.id) + '" data-phone="' + esc(item.phone) + '"><strong>💬 ' + esc(item.name) + '</strong><span>' + esc(item.phone) + '</span></button>').join("");
      openModal({ ...base, title: choices.length > 1 ? "Elige el WhatsApp" : "¿Abrimos WhatsApp?", lead: choices.length ? "El mensaje quedará escrito para que tú pulses Enviar en WhatsApp." : "Primero buscaré el contacto y después podrás revisar el número.", body: message + (numbers ? '<div class="contact-options">' + numbers + '</div>' : ""), actions: [
        { label: "Ahora no", kind: "secondary", onClick: closeLayers },
        { label: "Cambiar mensaje", kind: "secondary", dataset:{a:"edit-whatsapp",id:note.id} },
        { label: "Indicar otro número", kind: "secondary", dataset:{a:"edit-whatsapp-phone",id:note.id} },
        ...(numbers ? [] : [{ label: "Buscar contacto", kind: "confirm", dataset:{a:"search-contact",id:note.id} }])
      ] });
      $("actionModal").classList.add("call-choice-modal");
      return;
    }
    if (intent === "contact.call") {
      const result = !note.phone && google ? google.getContactResult(note.id) : null;
      if (result) {
        if (result.error) {
          openModal({ ...base, title: "Contacto", lead: result.error, actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
          return;
        }
        const options = result.contacts.flatMap(contact => contact.phones.map(phone => {
          const number = google.contactTel(phone);
          return '<button class="contact-choice" data-a="call" data-id="' + esc(note.id) + '" data-phone="' + esc(number) + '"><strong>📞 ' + esc(contact.name) + '</strong><span>' + esc(number) + "</span></button>";
        })).join("");
        if (options) {
          openModal({ ...base, title: "¿A qué número llamamos?", lead: "Toca un número para abrir el marcador.", body: entryBody(note) + '<div class="contact-options">' + options + "</div>", actions: [{ label: "Ahora no", kind: "secondary", onClick: closeLayers }] });
          return;
        }
        openModal({ ...base, title: "Contacto", lead: "No he encontrado un teléfono disponible.", actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
        return;
      }
      openModal({ ...base, title: note.aiIntent?.title || "Llamar", lead: "Puedes llamar ahora o dejar la llamada programada.", actions: [
        { label: "Ahora no", kind: "secondary", onClick: closeLayers },
        { label: "📞 Llamar ahora", kind: "confirm", dataset: { a: note.phone ? "call" : "search-contact", id: note.id, phone: note.phone || "" } },
        { label: "Crear recordatorio", kind: "secondary", dataset: { a: "defer-call-reminder", id: note.id } },
        { label: "Agendar llamada", kind: "secondary", dataset: { a: "defer-call-calendar", id: note.id } }
      ] });
      $("actionModal").classList.add("call-choice-modal");
      return;
    }
    if (["calendar.query", "calendar.update", "calendar.delete"].includes(intent)) {
      if (intent === "calendar.delete" && note.proposal?.actionStatus === "completed") {
        showCompletion({ title: "Evento cancelado", lead: "He cancelado el evento seleccionado." });
        return;
      }
      if (intent === "calendar.update" && note.proposal?.actionStatus === "completed") {
        showCompletion({ title: "Evento modificado", lead: "He actualizado el recordatorio seleccionado." });
        return;
      }
      const label = intent === "calendar.query" ? "📅 Consultar" : "Buscar coincidencias";
      const title = intent === "calendar.query" ? "Consultar calendario" : intent === "calendar.update" ? "Modificar evento" : "Cancelar evento";
      const result = google?.getCalendarResult(note.id);
      if (intent === "calendar.delete" && result && !result.error && !result.events.length) {
        const body = document.createElement("div");
        const label = document.createElement("label");
        label.textContent = "Fecha en la que quieres buscar";
        const date = document.createElement("input");
        date.id = "cancelSearchDate";
        date.type = "date";
        label.append(date);
        body.append(label);
        openModal({ ...base, title: "No encuentro coincidencias en ese periodo",
          lead: note.aiIntent?.target?.date ? "Puedes buscar en otra fecha." : "He buscado en los próximos 90 días. Si la llamada es posterior, indica su fecha para buscarla.",
          body, actions: [
            { label: "Ahora no", kind: "secondary", onClick: closeLayers },
            { label: "Buscar en esa fecha", kind: "confirm", dataset: { a: "search-calendar-date", id: note.id } }
          ] });
        return;
      }
      const body = result ? entryBody(note) + calendarActions(note, google) : base.body;
      openModal({ ...base, title, body, actions: result ? [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] : [{ label: "Ahora no", kind: "secondary", onClick: closeLayers }, { label, kind: "confirm", dataset: { a: "search-calendar", id: note.id } }] });
      return;
    }
    showCompletion({ title: "✓ Guardado en Angeli", lead: "Ya está sincronizado en tu conversación.", body: entryBody(note) });
  }

  function showCalendarFieldEditor(note, field, { onSave, onMic, onCancel } = {}) {
    const details = calendarDetails(note), isReminderTitle = field === "reminderTitle", isLocation = field === "location", isTitle = field === "title" || isReminderTitle;
    const draft = document.createElement("textarea");
    draft.id = "calendarFieldDraft";
    draft.className = "active-draft conversation-draft";
    draft.rows = isTitle ? 2 : 4;
    draft.placeholder = isTitle ? "Di o escribe el título exacto…" : isLocation ? "Di o escribe el recinto o dirección…" : "Di o escribe la descripción…";
    draft.value = isReminderTitle ? scheduleTitle(note) : isTitle ? details.title : isLocation ? details.location : details.description;
    const controls = document.createElement("div");
    controls.className = "conversation-controls";
    const mic = document.createElement("button");
    mic.type = "button"; mic.className = "conversation-mic"; mic.textContent = "🎙️ Hablar";
    mic.onclick = () => { draft.blur(); onMic?.("calendarFieldDraft"); };
    const save = document.createElement("button");
    save.type = "button"; save.className = "confirm conversation-send"; save.textContent = "Guardar cambio ➤";
    save.onclick = () => { const value = draft.value.trim(); if (isTitle && !value) return notify("El título no puede quedar vacío"); onSave?.(value); };
    controls.append(mic, save);
    const content = document.createElement("div"); content.className = "conversation-question"; content.append(draft, controls);
    openModal({ title: isReminderTitle ? "Cambiar aviso" : isTitle ? "Cambiar título" : isLocation ? (details.location ? "Cambiar ubicación" : "Añadir ubicación") : details.description ? "Cambiar descripción" : "Añadir descripción", lead: isReminderTitle ? "Esto será lo que veas en el aviso anterior." : isTitle ? "Esto será lo que veas en Calendar y en el aviso del móvil." : isLocation ? "Este recinto o dirección se guardará en el campo Ubicación de Calendar." : "Es opcional. Puedes dictarla o dejarla vacía.", body: content, actions: [{ label: "Volver", kind: "secondary", onClick: onCancel }] });
    $("actionModal").classList.add("conversation-modal");
    draft.focus();
  }

  function showCalendarDateTimeEditor(note,{onSave,onCancel}={}){
    const reminder=Boolean(note.schedule)&&note.proposal?.intent!=="calendar.create",due=reminder?note.schedule?.dueAt||"":"";
    const currentDate=reminder?due.slice(0,10):note.scheduledDate||note.aiIntent?.date||"",currentTime=reminder?due.slice(11,16):note.scheduledTime||note.aiIntent?.time||"";
    const content=document.createElement("div");content.className="conversation-question calendar-datetime-editor";
    const dateLabel=document.createElement("label");dateLabel.textContent="Fecha";
    const date=document.createElement("input");date.id="calendarDateDraft";date.type="date";date.value=currentDate;dateLabel.append(date);
    const timeLabel=document.createElement("label");timeLabel.textContent="Hora";
    const time=document.createElement("input");time.id="calendarTimeDraft";time.type="time";time.value=currentTime;timeLabel.append(time);
    const save=document.createElement("button");save.type="button";save.className="confirm conversation-send";save.textContent="Guardar fecha y hora ➤";
    save.onclick=()=>{if(!date.value||!time.value)return notify("Indica la fecha y la hora");onSave?.({date:date.value,time:time.value})};
    content.append(dateLabel,timeLabel,save);
    openModal({title:"Cambiar fecha y hora",lead:"Corrige cuándo debe aparecer en Calendar.",body:content,actions:[{label:"Volver",kind:"secondary",onClick:onCancel}]});
    $("actionModal").classList.add("conversation-modal");
    date.focus();
  }

  function showWhatsAppEditor(note, { onSave, onCancel, onMic } = {}) {
    const draft = document.createElement("textarea");
    draft.id = "whatsappMessageDraft";
    draft.className = "active-draft conversation-draft";
    draft.rows = 5;
    draft.value = note.aiIntent?.notes || "";
    draft.placeholder = "Escribe el mensaje…";
    openModal({ title: "Editar mensaje", lead: "Este texto se abrirá preparado en WhatsApp.", body: draft, actions: [
      { label: "Volver", kind: "secondary", onClick: onCancel },
      { label: "🎙️ Dictar", kind: "secondary", onClick: () => { draft.blur(); onMic?.(draft.id); } },
      { label: "Guardar texto", kind: "confirm", onClick: () => { const value=draft.value.trim(); if(!value){notify("Escribe el mensaje");return} onSave?.(value); } }
    ] });
    $("actionModal").classList.add("conversation-modal");
    draft.focus();
  }

  function showWhatsAppPhoneEditor(note, { onSave, onCancel } = {}) {
    const phone = document.createElement("input");
    phone.type = "tel";
    phone.value = note.phone || "";
    phone.placeholder = "+34 600 000 000";
    openModal({ title: "Indicar otro número", lead: "Escribe el prefijo del país y el teléfono.", body: phone, actions: [
      { label: "Volver", kind: "secondary", onClick: onCancel },
      { label: "Usar este número", kind: "confirm", onClick: () => { if(!whatsappPhone(phone.value)){notify("Revisa el número y añade el prefijo internacional");return} onSave?.(phone.value.trim()); } }
    ] });
    phone.focus();
  }

  function showInteractionQuestion(note, { onSend, onMic, onCancel, value = "" } = {}) {
    const interaction = note.interaction || {};
    const fallback = interaction.source === "fallback";
    const draft = document.createElement("textarea");
    draft.id = "conversationDraft";
    draft.className = "active-draft conversation-draft";
    draft.rows = 3;
    draft.placeholder = "Responde por voz o escribe aquí…";
    draft.value = value;

    const controls = document.createElement("div");
    controls.className = "conversation-controls";
    const mic = document.createElement("button");
    mic.type = "button";
    mic.className = "conversation-mic";
    mic.textContent = "🎙️ Hablar";
    mic.setAttribute("aria-label", "Responder por voz");
    mic.onclick = () => { draft.blur(); onMic?.(); };
    const send = document.createElement("button");
    send.type = "button";
    send.className = "confirm conversation-send";
    send.textContent = "Continuar ➤";
    const submit = () => {
      const response = draft.value.trim();
      if (!response) {
        notify("Dime o escribe la respuesta para continuar");
        return;
      }
      onSend?.(response);
    };
    send.onclick = submit;
    draft.onkeydown = event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    };
    controls.append(mic, send);

    const content = document.createElement("div");
    content.className = "conversation-question";
    content.innerHTML = entryBody(note);
    if (fallback) {
      const explanation = document.createElement("p");
      explanation.className = "card-details meta";
      explanation.textContent = "No quiero asumir una acción: confírmame o completa este detalle.";
      content.append(explanation);
    }
    content.append(draft, controls);
    openModal({
      title: fallback ? "Necesito asegurarme" : "Solo me falta un dato",
      lead: interaction.question || "¿Puedes completar la información que falta?",
      body: content,
      actions: [
        { label: "Cancelar", kind: "secondary", onClick: onCancel || closeLayers }
      ]
    });
    $("actionModal").classList.add("conversation-modal");
    // Real reportado: el cuadro se abría sin el cursor puesto, así que
    // escribir a mano exigía tocar el cuadro primero — y dictar por voz
    // (que sí escribe aquí en cuanto se abre, vía updateDraft) pasaba
    // desapercibido si la persona no había mirado dos veces. El cursor
    // debe quedar puesto en cuanto se abre el modal, listo para cualquiera
    // de las dos vías (voz o teclado) sin tocar nada antes.
    draft.focus();
  }

  function showCalendarEvent(note, google, eventId, {onEdit}={}) {
    const event = google.getCalendarResult(note.id)?.events?.find(item => item.id === eventId);
    if (!event) { showEntryAction(note, google); return; }
    openModal({title: event.summary, lead: event.when,
      body: '<div class="calendar-confirmation"><span class="calendar-field-label">Fecha y hora</span><b>' + esc(event.when) + '</b><span class="calendar-field-label">Ubicación</span><b>' + esc(event.location||'Sin ubicación') + '</b><span class="calendar-field-label">Descripción</span><b>' + esc(event.description||'Sin descripción') + '</b></div>',
      actions: [
        {label:'Volver a la agenda', kind:'soft', onClick:()=>showEntryAction(note,google)},
        {label:'Anular este evento', kind:'danger', dataset:{a:'agenda-delete',id:note.id,eventId:event.id}},
        {label:'Modificar', kind:'secondary', onClick:()=>onEdit?.(event)}
      ]});
  }

  function showCalendarEventEditor(event,{onSave,onCancel}={}){
    const form=document.createElement("div");form.className="record-editor";
    form.innerHTML='<label>Título<input id="eventEditTitle" type="text"></label><label>Fecha<input id="eventEditDate" type="date"></label><label>Hora<input id="eventEditTime" type="time"></label><label>Ubicación<input id="eventEditLocation" type="text"></label><label>Descripción<textarea id="eventEditNotes" rows="3"></textarea></label>';
    openModal({title:"Modificar evento",lead:"Puedes cambiar cualquier dato de esta cita.",body:form,actions:[{label:"Volver",kind:"secondary",onClick:onCancel},{label:"Guardar cambios",kind:"confirm",onClick:()=>onSave?.({title:$("eventEditTitle").value.trim(),date:$("eventEditDate").value,time:$("eventEditTime").value,location:$("eventEditLocation").value.trim(),notes:$("eventEditNotes").value.trim()})}]});
    $("eventEditTitle").value=event.summary||"";$("eventEditDate").value=event.start?.slice(0,10)||"";$("eventEditTime").value=event.allDay?"":event.start?.slice(11,16)||"";$("eventEditLocation").value=event.location||"";$("eventEditNotes").value=event.description||"";
  }

  function calendarActions(note, google) {
    const intent = note.proposal?.intent;
    if (note.calendarStatus === "synced") {
      const link = note.calendarUrl ? ' · <a href="' + esc(note.calendarUrl) + '" target="_blank" rel="noopener">Abrir</a>' : "";
      return '<div class="done-message">✓ Añadido al calendario' + link + "</div>";
    }
    if (note.calendarStatus === "cancelled") return '<div class="done-message">✓ Evento cancelado</div>';
    if (intent === "calendar.create") return actionButton(note.id, "📅 Ver acción", "show-action");
    const result = google.getCalendarResult(note.id);
    if (!result) return actionButton(note.id, "Ver acción", "show-action");
    if (result.error) return '<div class="card-details meta">' + esc(result.error) + "</div>";
    if (!result.events.length) return '<div class="card-details meta">No he encontrado coincidencias.</div>';
    const choices = result.events.map(event => {
      let button = "";
      if (intent === "calendar.query") button = '<div class="agenda-row-actions">' + eventButton(note.id, event.id, "Ver", "primary", "agenda-view") + eventButton(note.id, event.id, "Anular", "danger", "agenda-delete") + '</div>';
      if (intent === "calendar.delete") button = eventButton(note.id, event.id, "Cancelar", "danger", "calendar-delete");
      if (intent === "calendar.update") button = eventButton(note.id, event.id, "Modificar", "primary", "calendar-update");
      return '<div class="choice agenda-choice"><div class="agenda-choice-content"><b>' + esc(event.summary) + "</b><span>" + esc(event.when) + "</span></div>" + button + "</div>";
    }).join("");
    return '<div class="card-details">' + choices + "</div>";
  }

  function contactActions(note, google) {
    if (note.phone) return '<div class="inline-actions"><a class="small-btn primary" href="tel:' + esc(note.phone) + '">📞 Llamar</a></div>';
    const result = google.getContactResult(note.id);
    if (!result) return actionButton(note.id, "📞 Ver acción", "show-action");
    if (result.error) return '<div class="card-details meta">' + esc(result.error) + "</div>";
    const links = result.contacts.flatMap(contact => contact.phones.map(phone => '<a class="small-btn primary" href="tel:' + esc(google.contactTel(phone)) + '">📞 ' + esc(contact.name) + "</a>"));
    return links.length ? '<div class="inline-actions">' + links.join("") + "</div>" : '<div class="card-details meta">No he encontrado a ' + esc(note.contactQuery || "ese contacto") + " en contactos.</div>";
  }

  function actionButton(id, label, action) {
    return '<div class="inline-actions"><button class="small-btn primary" data-a="' + action + '" data-id="' + esc(id) + '">' + label + "</button></div>";
  }

  function eventButton(noteId, eventId, label, kind, action) {
    return '<button class="small-btn ' + kind + '" data-a="' + action + '" data-id="' + esc(noteId) + '" data-event-id="' + esc(eventId) + '">' + label + "</button>";
  }

  async function hydrateImages() {
    for (const image of document.querySelectorAll("img[data-image-id]")) {
      try {
        const media = await getMedia("images", image.dataset.imageId);
        if (!media) continue;
        const url = URL.createObjectURL(media.blob);
        image.src = url;
        image.dataset.objectUrl = url;
      } catch (_) {}
    }
  }

  function render({ notes, selectedFilter, selectedType, google, noteSettings }) {
    currentNoteSettings = normalizeNoteSettings(noteSettings);
    document.querySelectorAll("img[data-object-url]").forEach(image => URL.revokeObjectURL(image.dataset.objectUrl));
    const query = $("search").value.toLowerCase().trim();
    const shown = notes.filter(note => {
      const matchesStatus = selectedFilter === "all" || note.status === selectedFilter;
      const matchesType = selectedType === "all" || note.type === selectedType;
      const classification = note.noteClassification || {}, mediaContext = note.mediaContext || {};
      const matchesQuery = !query || [note.text, note.aiIntent?.title, classification.scope, classification.relationName, classification.purpose, ...(classification.tags || []), mediaContext.purpose, mediaContext.categoryLabel, mediaContext.relationTypeLabel, mediaContext.relationName, ...(note.files || []).map(file => file.name || file)].filter(Boolean).join(" ").toLowerCase().includes(query);
      return matchesStatus && matchesType && matchesQuery;
    });
    const cards = shown.map(note => renderCard(note, google)).join("");
    $("list").innerHTML = shown.length ? '<div class="day">Entradas recientes</div>' + cards : '<div class="empty">No hay entradas que mostrar.</div>';
    hydrateImages();
  }

  async function hydrateLibraryImages() {
    for (const image of document.querySelectorAll("#libraryList img[data-library-image]")) {
      if (!image.isConnected) continue;
      try {
        const media = await getMedia("images", image.dataset.libraryImage);
        if (!media || !image.isConnected) continue;
        const url = URL.createObjectURL(media.blob);
        image.src = url;
        image.dataset.objectUrl = url;
      } catch (_) {
        image.alt = "No se pudo cargar la miniatura";
      }
    }
  }

  function renderMediaLibrary(items, state = {}) {
    document.querySelectorAll("#libraryList img[data-object-url]").forEach(image => URL.revokeObjectURL(image.dataset.objectUrl));
    const shown = filterMediaLibrary(items, state);
    $("libraryTitle").textContent = state.kind === "image" ? "Galería" : state.kind === "file" ? "Archivos" : "Fotos y archivos";
    $("libraryCount").textContent = `${shown.length} elemento${shown.length === 1 ? "" : "s"}`;
    const categories = [...new Map(items.map(item => [item.category, item.categoryLabel])).entries()];
    $("libraryCategory").innerHTML = '<option value="all">Todas las categorías</option>' + categories.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
    $("libraryCategory").value = state.category || "all";
    $("libraryList").innerHTML = shown.length ? '<div class="library-grid">' + shown.map(item => {
      const preview = item.kind === "image" ? `<img data-library-image="${esc(item.driveId)}" alt="${esc(item.name)}">` : '<span aria-hidden="true">📄</span>';
      const date = item.date ? new Date(item.date).toLocaleDateString("es-ES") : "";
      const meta = [item.categoryLabel, date, mediaSize(item.size)].filter(Boolean).join(" · ");
      const linkedNote = item.entryType === "note" ? `<span title="Vinculado a una nota">📝 Nota vinculada</span>` : "";
      return `<article class="library-item"><button class="library-preview" data-library-action="open" data-library-key="${esc(item.key)}" aria-label="Abrir ${esc(item.name)}">${preview}</button><div class="library-item-body"><strong title="${esc(item.name)}">${esc(item.name)}</strong><span>${esc(meta)}</span><span title="${esc(item.entryText)}">${esc(item.entryText)}</span>${linkedNote}${item.relation?`<span title="${esc(item.relation)}">🔗 ${esc(item.relation)}</span>`:""}<div class="library-actions"><button data-library-action="entry" data-library-key="${esc(item.key)}">Ver ficha</button><button data-library-action="share" data-library-key="${esc(item.key)}">Compartir</button></div></div></article>`;
    }).join("") + "</div>" : '<div class="empty">No hay fotos o archivos con estos filtros.</div>';
    void hydrateLibraryImages();
  }

  function renderNoteLibrary(items, state = {}) {
    const query = String(state.query || "").trim().toLowerCase();
    const shown = items.filter(note => {
      const classification = note.noteClassification || {};
      const statusMatches = state.status === "all" || (state.status === "done" ? note.status === "done" : note.status !== "done");
      const categoryMatches = state.category === "all" || classification.scope === state.category;
      const haystack = [noteTitle(note), note.text, classification.categoryLabel, classification.scope, classification.relationTypeLabel, classification.relationName, classification.purpose, ...(classification.tags || [])].filter(Boolean).join(" ").toLowerCase();
      return statusMatches && categoryMatches && (!query || haystack.includes(query));
    });
    $("noteLibraryCount").textContent = `${shown.length} nota${shown.length === 1 ? "" : "s"}`;
    const categories = [...new Map(items.map(note => {
      const classification = note.noteClassification || {};
      return [classification.scope || "general", settingLabel(currentNoteSettings, "categories", classification.scope, classification.categoryLabel || "General")];
    })).entries()];
    $("noteLibraryCategory").innerHTML = '<option value="all">Todas las categorías</option>' + categories.map(([value,label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
    $("noteLibraryCategory").value = state.category || "all";
    $("noteLibraryList").innerHTML = shown.length ? '<div class="note-library-grid">' + shown.map(note => {
      const classification = note.noteClassification || {};
      const category = settingLabel(currentNoteSettings, "categories", classification.scope, classification.categoryLabel || "General");
      const relation = classification.relationName ? `${settingLabel(currentNoteSettings, "relationTypes", classification.relationType, classification.relationTypeLabel)}: ${classification.relationName}` : "";
      const date = note.date ? new Date(note.date).toLocaleDateString("es-ES") : "";
      const done = note.status === "done";
      const attachmentCount = (note.images || []).length + (note.files || []).length;
      return `<article class="note-library-item${done ? " done" : ""}"><div class="note-library-top"><strong>${esc(noteTitle(note))}</strong><span class="note-library-state">${done ? "Hecha" : "Pendiente"}</span></div><p>${esc(note.text || "Sin contenido")}</p><div class="note-library-meta"><span>${esc(category)}</span>${relation ? `<span>· ${esc(relation)}</span>` : ""}${date ? `<span>· ${esc(date)}</span>` : ""}${attachmentCount ? `<span>· 📎 ${attachmentCount}</span>` : ""}</div><div class="note-library-actions"><button class="primary" data-note-action="open" data-note-id="${esc(note.id)}">Ver ficha</button><button data-note-action="edit" data-note-id="${esc(note.id)}">Reclasificar</button><button data-note-action="toggle" data-note-id="${esc(note.id)}">${done ? "Reabrir" : "✓ Hecha"}</button><button data-note-action="delete" data-note-id="${esc(note.id)}">Borrar</button></div></article>`;
    }).join("") + "</div>" : '<div class="empty">No hay notas con estos filtros.</div>';
  }

  function openNoteLibrary(items, state) {
    renderNoteLibrary(items, state);
    $("noteLibrary").classList.add("show");
    $("noteLibrary").setAttribute("aria-hidden", "false");
  }

  function closeNoteLibrary() {
    $("noteLibrary").classList.remove("show");
    $("noteLibrary").setAttribute("aria-hidden", "true");
  }

  const DIETARIO_TYPE_ICON = { calendar: "📅", reminder: "🔔", note: "📝", attach: "🗂️" };

  function dietarioItemMarkup(item) {
    return `<span class="dietario-rail ${item.rail}"></span><div class="dietario-icon ${item.rail}">${DIETARIO_TYPE_ICON[item.rail] || "📌"}</div><div class="dietario-body"><div class="dietario-top"><b>${esc(item.title)}</b>${item.time ? `<span class="dietario-time">${esc(item.time)}</span>` : ""}</div>${item.subtitle ? `<div class="dietario-sub">${esc(item.subtitle)}</div>` : ""}${item.attachmentCount ? `<span class="dietario-attachments">📎 ${item.attachmentCount}</span>` : ""}</div><button class="dietario-quick" data-dietario-quick="${esc(item.id)}" aria-label="Más opciones">⋮</button>`;
  }

  function renderDietario(notes, state = {}) {
    const { days, undated } = groupDietarioByDay(notes, { range: state.range || "week", type: state.type || "all" });
    const total = days.reduce((sum, day) => sum + day.items.length, 0) + undated.length;
    $("dietarioCount").textContent = `${total} elemento${total === 1 ? "" : "s"}`;
    if (!total) { $("dietarioList").innerHTML = '<div class="empty">No hay nada que mostrar en el dietario con estos filtros.</div>'; return; }
    const daysHtml = days.map(day => `<div class="dietario-day" data-dietario-day="${esc(day.dateKey)}"><div class="dietario-day-head"><span class="dow">${esc(day.label.weekday)}</span><span class="num">${esc(day.label.day)}</span>${day.isToday ? '<span class="today-pill">Hoy</span>' : ""}</div>${day.items.map(item => `<div class="dietario-item" data-dietario-id="${esc(item.id)}" data-dietario-item-type="${esc(item.type)}">${dietarioItemMarkup(item)}</div>`).join("")}</div>`).join("");
    const undatedHtml = undated.length ? `<div class="dietario-day dietario-undated"><div class="dietario-day-head"><span class="num">Sin fecha</span></div>${undated.map(item => `<div class="dietario-item" data-dietario-id="${esc(item.id)}" data-dietario-item-type="${esc(item.type)}">${dietarioItemMarkup(item)}</div>`).join("")}</div>` : "";
    $("dietarioList").innerHTML = daysHtml + undatedHtml;
  }

  function openDietario(notes, state) {
    renderDietario(notes, state);
    $("dietarioLibrary").classList.add("show");
    $("dietarioLibrary").setAttribute("aria-hidden", "false");
  }

  function closeDietario() {
    $("dietarioLibrary").classList.remove("show");
    $("dietarioLibrary").setAttribute("aria-hidden", "true");
  }

  function shoppingItemMarkup(item) {
    const storeLabel = item.store === "mercadona" ? "Mercadona" : item.store === "consum" ? "Consum" : "";
    const storeBadge = storeLabel ? `<span class="store-badge store-${esc(item.store)}">${esc(storeLabel)}</span>` : "";
    const price = item.product?.price != null ? `<span class="shopping-price">${Number(item.product.price).toFixed(2)} €</span>` : (item.store ? '<span class="shopping-price muted">sin vincular</span>' : "");
    const link = item.product?.url ? `<a href="${esc(item.product.url)}" target="_blank" rel="noopener" class="shopping-product-link">Ver en Mercadona</a>` : "";
    const quantity = item.quantity || 1;
    const thumb = item.product?.thumbnail ? `<img class="shopping-thumb" src="${esc(item.product.thumbnail)}" alt="">` : '<div class="shopping-thumb placeholder">🛒</div>';
    const stepper = `<div class="shopping-qty-stepper"><button type="button" class="shopping-qty-btn" data-a="qty-dec" aria-label="Quitar una unidad de ${esc(item.name)}">−</button><span class="shopping-qty-value">${quantity}</span><button type="button" class="shopping-qty-btn" data-a="qty-inc" aria-label="Añadir una unidad de ${esc(item.name)}">+</button></div>`;
    return `<div class="shopping-item${item.checked ? " done" : ""}" data-shopping-id="${esc(item.id)}">` +
      `<button class="shopping-check${item.checked ? " on" : ""}" data-a="toggle" aria-label="${item.checked ? "Marcar como pendiente" : "Marcar como comprado"}">${item.checked ? "✓" : ""}</button>` +
      thumb +
      `<div class="shopping-item-body"><strong>${esc(item.name)}</strong><span class="shopping-meta">${storeBadge}${price}${link}</span></div>` +
      stepper +
      `<button class="small-btn danger" data-a="remove" aria-label="Quitar ${esc(item.name)}">✕</button></div>`;
  }

  function shoppingListCardMarkup(list) {
    const pending = list.items.filter(item => !item.checked).length, done = list.items.length - pending;
    const thumbs = list.items.slice(0, 4).map(item => item.product?.thumbnail ? `<div style="background-image:url('${esc(item.product.thumbnail)}')"></div>` : '<div class="ph">🛒</div>');
    while (thumbs.length < 4) thumbs.push('<div class="ph"></div>');
    return `<article class="shopping-list-card" data-shopping-list-id="${esc(list.id)}">` +
      `<div class="shopping-thumb-grid">${thumbs.join("")}</div>` +
      `<div class="shopping-list-card-body"><strong>${esc(list.name)}</strong><span>${list.items.length} artículo${list.items.length === 1 ? "" : "s"}${done ? ` · ${done} comprado${done === 1 ? "" : "s"}` : ""}</span></div>` +
      `<button class="shopping-list-quick" data-shopping-quick="${esc(list.id)}" aria-label="Opciones de ${esc(list.name)}">⋮</button></article>`;
  }

  // Se comparte entre la búsqueda en vivo dentro de una lista y el modal de
  // confirmación al pedir un artículo por voz — mismo aspecto en los dos
  // sitios donde aparecen resultados reales de Mercadona.
  function shoppingSuggestionMarkup(product, index) {
    const thumb = product.thumbnail ? `<img class="shopping-thumb sm" src="${esc(product.thumbnail)}" alt="">` : '<div class="shopping-thumb sm placeholder">🛒</div>';
    const meta = [product.packaging, product.price != null ? `${Number(product.price).toFixed(2)} €` : ""].filter(Boolean).join(" · ");
    return `<button type="button" class="shopping-suggestion" data-suggestion="${index}">${thumb}<span class="suggestion-body"><strong>${esc(product.name)}</strong><span>${esc(meta)}</span></span></button>`;
  }

  function hideAllShoppingScreens() {
    $("shoppingOverview").hidden = true;
    $("shoppingDetail").hidden = true;
    $("shoppingCart").hidden = true;
    $("shoppingPurchases").hidden = true;
  }

  function renderShoppingOverview(state) {
    $("shoppingBack").hidden = true;
    $("shoppingDetailMenu").hidden = true;
    $("shoppingLibraryTitle").textContent = "Mis listas";
    $("shoppingLibrarySubtitle").textContent = `${state.lists.length} lista${state.lists.length === 1 ? "" : "s"}`;
    hideAllShoppingScreens();
    $("shoppingOverview").hidden = false;
    $("shoppingOverviewList").innerHTML = state.lists.map(shoppingListCardMarkup).join("");
  }

  function renderShoppingDetail(list, total = 0) {
    if (!list) return;
    $("shoppingBack").hidden = false;
    $("shoppingDetailMenu").hidden = false;
    $("shoppingLibraryTitle").textContent = list.name;
    const pending = list.items.filter(item => !item.checked), done = list.items.filter(item => item.checked);
    $("shoppingLibrarySubtitle").textContent = `${pending.length} pendiente${pending.length === 1 ? "" : "s"}${done.length ? ` · ${done.length} comprado${done.length === 1 ? "" : "s"}` : ""}`;
    hideAllShoppingScreens();
    $("shoppingDetail").hidden = false;
    $("shoppingList").innerHTML = list.items.length
      ? pending.map(shoppingItemMarkup).join("") + (done.length ? '<div class="day">Comprado</div>' + done.map(shoppingItemMarkup).join("") : "")
      : '<div class="empty">Esta lista está vacía. Escribe un artículo arriba para buscarlo o añadirlo.</div>';
    $("shoppingTotalBar").hidden = !(total > 0);
    if (total > 0) $("shoppingTotalValue").textContent = `Total aproximado ${total.toFixed(2)} €`;
  }

  // El check de la lista de siempre ya no significa "comprado" — significa
  // "lo quiero esta vez". "Añadir al carrito" copia lo marcado aquí, con su
  // propio check (ahora sí, "ya está en el carro real") y su propio stepper
  // de cantidad, independiente del de la lista.
  function shoppingCartItemMarkup(item) {
    const storeLabel = item.store === "mercadona" ? "Mercadona" : item.store === "consum" ? "Consum" : "";
    const storeBadge = storeLabel ? `<span class="store-badge store-${esc(item.store)}">${esc(storeLabel)}</span>` : "";
    const price = item.product?.price != null ? `<span class="shopping-price">${Number(item.product.price).toFixed(2)} €</span>` : "";
    const quantity = item.quantity || 1;
    const thumb = item.product?.thumbnail ? `<img class="shopping-thumb" src="${esc(item.product.thumbnail)}" alt="">` : '<div class="shopping-thumb placeholder">🛒</div>';
    const stepper = `<div class="shopping-qty-stepper"><button type="button" class="shopping-qty-btn" data-a="cart-qty-dec" aria-label="Quitar una unidad de ${esc(item.name)}">−</button><span class="shopping-qty-value">${quantity}</span><button type="button" class="shopping-qty-btn" data-a="cart-qty-inc" aria-label="Añadir una unidad de ${esc(item.name)}">+</button></div>`;
    return `<div class="shopping-item${item.checked ? " done" : ""}" data-shopping-cart-id="${esc(item.id)}">` +
      `<button class="shopping-check${item.checked ? " on" : ""}" data-a="cart-toggle" aria-label="${item.checked ? "Marcar como pendiente" : "Ya está en el carro"}">${item.checked ? "✓" : ""}</button>` +
      thumb +
      `<div class="shopping-item-body"><strong>${esc(item.name)}</strong><span class="shopping-meta">${storeBadge}${price}</span></div>` +
      stepper +
      `<button class="small-btn danger" data-a="cart-remove" aria-label="Quitar ${esc(item.name)} del carrito">✕</button></div>`;
  }

  function renderShoppingCart(list) {
    if (!list) return;
    $("shoppingBack").hidden = false;
    $("shoppingDetailMenu").hidden = true;
    $("shoppingLibraryTitle").textContent = `🛒 ${list.name}`;
    const cart = list.cart || [];
    const pending = cart.filter(item => !item.checked), done = cart.filter(item => item.checked);
    $("shoppingLibrarySubtitle").textContent = cart.length ? `${pending.length} por comprar${done.length ? ` · ${done.length} en el carro` : ""}` : "El carrito está vacío";
    hideAllShoppingScreens();
    $("shoppingCart").hidden = false;
    $("shoppingCartList").innerHTML = cart.length
      ? pending.map(shoppingCartItemMarkup).join("") + (done.length ? '<div class="day">Ya en el carro</div>' + done.map(shoppingCartItemMarkup).join("") : "")
      : '<div class="empty">Todavía no has añadido nada al carrito. Marca artículos en la lista y pulsa "🛒 Añadir al carrito".</div>';
    $("shoppingFinishPurchase").hidden = !done.length;
  }

  // Solo suma lo que tenga un precio real vinculado a Mercadona en el
  // momento de comprarlo — igual que shoppingListTotal con la lista activa.
  function purchaseTotal(purchase) {
    return purchase.items.reduce((sum, item) => sum + (item.product?.price != null ? Number(item.product.price) * (item.quantity || 1) : 0), 0);
  }

  function shoppingPurchaseMarkup(purchase) {
    const date = esc(new Date(purchase.date).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }));
    const items = purchase.items.map(item => `${item.quantity > 1 ? item.quantity + "× " : ""}${esc(item.name)}`).join(" · ");
    const total = purchaseTotal(purchase);
    const totalLine = total > 0 ? `<div class="purchase-total">${total.toFixed(2)} €</div>` : "";
    return `<button type="button" class="purchase-card" data-shopping-purchase-id="${esc(purchase.id)}"><div class="purchase-date">${date}${totalLine}</div><div class="purchase-items">${items}</div></button>`;
  }

  function renderShoppingPurchases(list) {
    if (!list) return;
    $("shoppingBack").hidden = false;
    $("shoppingDetailMenu").hidden = true;
    $("shoppingLibraryTitle").textContent = `🧾 Compras · ${list.name}`;
    const purchases = list.purchases || [];
    $("shoppingLibrarySubtitle").textContent = `${purchases.length} compra${purchases.length === 1 ? "" : "s"}`;
    hideAllShoppingScreens();
    $("shoppingPurchases").hidden = false;
    $("shoppingPurchasesList").innerHTML = purchases.length ? purchases.map(shoppingPurchaseMarkup).join("") : '<div class="empty">Todavía no has finalizado ninguna compra.</div>';
  }

  // Ficha de una compra ya finalizada: pedido explícito para ver, al pulsar
  // en el historial, cada artículo con su precio y el total de esa compra —
  // no solo los nombres, como enseñaba el historial hasta ahora.
  function showPurchaseDetail(purchase) {
    const date = new Date(purchase.date).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const total = purchaseTotal(purchase);
    const body = document.createElement("div");
    body.innerHTML = purchase.items.map(item => {
      const storeLabel = item.store === "mercadona" ? "Mercadona" : item.store === "consum" ? "Consum" : "";
      const storeBadge = storeLabel ? `<span class="store-badge store-${esc(item.store)}">${esc(storeLabel)}</span>` : "";
      const unitPrice = item.product?.price != null ? Number(item.product.price) : null;
      const lineTotal = unitPrice != null ? `<span class="shopping-price">${(unitPrice * (item.quantity || 1)).toFixed(2)} €</span>` : "";
      const unitLabel = unitPrice != null && item.quantity > 1 ? `<span class="shopping-meta-unit">${unitPrice.toFixed(2)} €/ud</span>` : "";
      return `<div class="shopping-item"><div class="shopping-item-body"><strong>${item.quantity > 1 ? item.quantity + "× " : ""}${esc(item.name)}</strong><span class="shopping-meta">${storeBadge}${unitLabel}</span></div>${lineTotal}</div>`;
    }).join("");
    openModal({
      title: date,
      lead: total > 0 ? `Total: ${total.toFixed(2)} €` : "Sin precios vinculados a Mercadona en esta compra.",
      body,
      actions: [{ label: "Cerrar", kind: "secondary", onClick: closeLayers }]
    });
  }

  function hideShoppingSuggestions() {
    $("shoppingSuggestions").hidden = true;
    $("shoppingSuggestions").innerHTML = "";
    $("shoppingLiveBadge").hidden = true;
  }
  function showShoppingSuggestionsMessage(message) {
    $("shoppingLiveBadge").hidden = false;
    $("shoppingSuggestions").hidden = false;
    $("shoppingSuggestions").innerHTML = `<div class="shopping-suggestions-empty">${esc(message)}</div>`;
  }
  function renderShoppingSuggestions(results) {
    $("shoppingLiveBadge").hidden = false;
    $("shoppingSuggestions").hidden = false;
    $("shoppingSuggestions").innerHTML = results.length ? results.map(shoppingSuggestionMarkup).join("") : '<div class="shopping-suggestions-empty">Sin resultados en Mercadona</div>';
  }
  // Sustituye al antiguo botón "+": un enlace de última instancia, visible
  // solo mientras hay algo escrito, para cuando ninguna coincidencia real
  // vale y hace falta guardar el texto tal cual.
  function setShoppingFallback(text, onClick) {
    const button = $("shoppingFallbackAdd");
    if (!text) { button.hidden = true; button.onclick = null; return; }
    button.hidden = false;
    button.textContent = `Ninguna es lo que busco → añadir «${text}» tal cual`;
    button.onclick = onClick;
  }

  function openShoppingList() {
    $("shoppingLibrary").classList.add("show");
    $("shoppingLibrary").setAttribute("aria-hidden", "false");
  }

  function closeShoppingList() {
    $("shoppingLibrary").classList.remove("show");
    $("shoppingLibrary").setAttribute("aria-hidden", "true");
  }

  // Modal que se abre al pedir un solo artículo por voz/texto: la búsqueda
  // de Mercadona ya sale lanzada con lo que se pidió, para elegir el
  // producto exacto en el mismo paso en el que se pidió — en vez de
  // vincularlo en silencio por detrás, sin preguntar.
  function showShoppingAddConfirm({ name, onInput, onPick, onFallback }) {
    const container = document.createElement("div");
    container.className = "shopping-confirm";
    container.innerHTML = `<div class="shopping-search-shell"><span class="ic">🔍</span><input id="shoppingConfirmInput" value="${esc(name)}" placeholder="Buscar en Mercadona…"></div>` +
      '<div class="live-badge"><span class="live-dot"></span>Mercadona · en vivo</div>' +
      '<div id="shoppingConfirmResults" class="shopping-suggestions shown"></div>' +
      '<button type="button" id="shoppingConfirmFallback" class="shopping-fallback-add"></button>';
    const input = container.querySelector("#shoppingConfirmInput");
    const fallback = container.querySelector("#shoppingConfirmFallback");
    const results = container.querySelector("#shoppingConfirmResults");
    const setFallbackLabel = value => { fallback.textContent = `Ninguna es lo que busco → añadir «${value}» tal cual`; };
    setFallbackLabel(name);
    input.oninput = () => { const value = input.value.trim() || name; setFallbackLabel(value); onInput?.(value); };
    fallback.onclick = () => onFallback?.(input.value.trim() || name);
    results.onclick = event => { const button = event.target.closest("[data-suggestion]"); if (button) onPick?.(Number(button.dataset.suggestion)); };
    openModal({ title: "¿Cuál añado?", lead: `Has pedido: «${esc(name)}»`, body: container, actions: [{ label: "Cancelar", kind: "secondary", onClick: closeLayers }] });
  }
  function renderShoppingConfirmResults(results) {
    const box = $("shoppingConfirmResults");
    if (!box) return; // el modal ya se cerró
    box.innerHTML = results.length ? results.map(shoppingSuggestionMarkup).join("") : '<div class="shopping-suggestions-empty">Sin resultados en Mercadona</div>';
  }
  // Paso extra del mic de añadir rápido: si hay más de una lista, se
  // pregunta a cuál antes de guardar (con una sola, se añade sin preguntar).
  function showShoppingListChoice(lists, onChoose) {
    openModal({
      title: "¿A qué lista lo añado?",
      lead: "Tienes varias listas de la compra.",
      actions: [
        ...lists.map(list => ({ label: `${list.name} · ${list.items.length} artículo${list.items.length === 1 ? "" : "s"}`, kind: "secondary", onClick: () => { closeLayers(); onChoose(list.id); } })),
        { label: "Cancelar", kind: "secondary", onClick: closeLayers }
      ]
    });
  }
  function setShoppingConfirmStatus(message) {
    const box = $("shoppingConfirmResults");
    if (box) box.innerHTML = `<div class="shopping-suggestions-empty">${esc(message)}</div>`;
  }

  // Ficha persistente para ver (no crear) una entrada del dietario. A
  // diferencia de showEntryAction, nunca se cierra sola: esa pantalla está
  // pensada para confirmar algo recién hecho, no para repasar algo que ya
  // existía. Reutiliza los mismos bloques de contenido que showEntryAction.
  function showDietarioDetail(note) {
    const bundled = note.proposal?.intent === "calendar.create" && note.schedule;
    const soloReminder = note.schedule && !bundled;
    const soloEvent = note.type === "calendar" && !note.schedule;
    let title, lead, body;
    if (bundled) {
      title = calendarDetails(note).title;
      lead = note.calendarStatus === "synced" && note.schedule.status === "scheduled" ? "Evento y aviso creados en Calendar." : scheduleState(note.schedule);
      body = entryBody(note) + calendarCard(note) +
        '<div class="calendar-confirmation"><span class="calendar-field-label">Aviso vinculado</span><strong>⏰ ' + esc(scheduleTitle(note)) + '</strong><span class="calendar-field-label">Cuándo avisa</span><b>' + esc(scheduleWhen(note.schedule)) + '</b></div>' +
        (note.calendarUrl ? '<p><a href="' + esc(note.calendarUrl) + '" target="_blank" rel="noopener">Abrir evento</a></p>' : '') +
        (note.schedule.calendarUrl ? '<p><a href="' + esc(note.schedule.calendarUrl) + '" target="_blank" rel="noopener">Abrir aviso</a></p>' : '');
    } else if (soloReminder) {
      title = scheduleTitle(note);
      lead = scheduleState(note.schedule);
      body = entryBody(note) + '<div class="calendar-confirmation"><span class="calendar-field-label">Cuándo</span><b>' + esc(scheduleWhen(note.schedule)) + '</b></div>' +
        (note.schedule.calendarUrl ? '<p><a href="' + esc(note.schedule.calendarUrl) + '" target="_blank" rel="noopener">Abrir aviso en Calendar</a></p>' : '');
    } else if (soloEvent) {
      title = calendarDetails(note).title;
      lead = note.calendarStatus === "synced" ? "En Calendar." : note.calendarStatus === "error" ? "No se pudo crear en Calendar." : "Pendiente de crear en Calendar.";
      body = entryBody(note) + calendarCard(note) +
        (note.calendarUrl ? '<p><a href="' + esc(note.calendarUrl) + '" target="_blank" rel="noopener">Abrir evento en Calendar</a></p>' : '');
    } else {
      title = note.aiIntent?.title || note.text || typeLabel(note.type);
      lead = note.status === "done" ? "Hecho." : "Pendiente.";
      body = entryBody(note);
    }
    openModal({ title, lead, body, actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
  }

  function openMediaLibrary(items, state) {
    renderMediaLibrary(items, state);
    $("mediaLibrary").classList.add("show");
    $("mediaLibrary").setAttribute("aria-hidden", "false");
  }

  function closeMediaLibrary() {
    closeMediaViewer();
    document.querySelectorAll("#libraryList img[data-object-url]").forEach(image => URL.revokeObjectURL(image.dataset.objectUrl));
    $("mediaLibrary").classList.remove("show");
    $("mediaLibrary").setAttribute("aria-hidden", "true");
  }

  function showMediaViewer(item, objectUrl, { onEntry, onShare }) {
    $("viewerTitle").textContent = item.name;
    $("viewerBody").innerHTML = `<img src="${esc(objectUrl)}" alt="${esc(item.name)}">`;
    $("mediaViewer").classList.add("show");
    $("mediaViewer").setAttribute("aria-hidden", "false");
    $("viewerEntry").onclick = onEntry;
    $("viewerShare").onclick = onShare;
  }

  function closeMediaViewer() {
    const image = $("viewerBody")?.querySelector("img");
    if (image?.src?.startsWith("blob:")) URL.revokeObjectURL(image.src);
    if ($("viewerBody")) $("viewerBody").innerHTML = "";
    $("mediaViewer")?.classList.remove("show");
    $("mediaViewer")?.setAttribute("aria-hidden", "true");
  }

  // La persona necesita saber, sin adivinarlo por el botón, con qué está
  // relacionado el adjunto: una nota concreta, o la persona/cliente/proyecto
  // que se eligió al clasificarlo.
  function mediaRelationCard(entry) {
    if (entry.type === "note") {
      return '<div class="calendar-confirmation"><span class="calendar-field-label">Vinculado a la nota</span><strong>📝 ' + esc(noteTitle(entry)) + '</strong>' +
        (entry.text ? '<span class="calendar-field-label">Contenido</span><b>' + esc(entry.text) + '</b>' : '') +
        '<span class="calendar-field-label">Estado</span><b>' + (entry.status === "done" ? "Hecha" : "Pendiente") + '</b></div>';
    }
    // Si mediaContextCard ya va a mostrar la relación (persona/cliente/proyecto),
    // no la repetimos aquí; solo lo decimos explícitamente cuando no hay ninguna.
    if (mediaContextRelation(entry.mediaContext || {})) return '';
    return '<div class="calendar-confirmation"><span class="calendar-field-label">Relacionado con</span><strong>Sin nota ni persona relacionada</strong></div>';
  }

  // Real encontrado en auditoría: para una entrada de tipo "note", el botón
  // "Clasificar ahora"/"Modificar clasificación" escribía en entry.mediaContext
  // (vía onEdit → showMediaContextEditor) en vez de en noteClassification,
  // que es donde vive de verdad la categoría/relación de una nota — creaba
  // una segunda clasificación divergente que Notas y Fotos/archivos
  // mostraban de forma distinta para la misma entrada. Una nota ya tiene su
  // propia vía completa de edición ("Abrir nota" → editor de la nota, con su
  // categoría/relación real), así que para notas no se ofrece este botón.
  function showMediaEntryDetail(entry, item, { onBack, onEdit, onNote } = {}) {
    const isNote = entry.type === "note";
    const context = entry.mediaContext;
    const contextCard = !isNote && context ? mediaContextCard(entry) : "";
    const emptyState = !isNote && !context ? '<div class="empty">Esta imagen es anterior a la clasificación. Puedes indicar ahora para qué la guardaste.</div>' : "";
    const body = mediaRelationCard(entry) + contextCard + emptyState;
    openModal({title:item.name || "Ficha del adjunto",lead:"Información para localizar este adjunto.",body,actions:[
      {label:"Volver",kind:"secondary",onClick:onBack},
      ...(isNote ? [] : [{label:context ? "Modificar clasificación" : "Clasificar ahora",kind:"secondary",onClick:()=>onEdit?.(entry)}]),
      {label:isNote ? "Abrir nota" : "Añadir nota",kind:"confirm",onClick:()=>onNote?.(entry)}
    ]});
  }

  function renderCard(note, google) {
    const id = esc(note.id);
    const location = note.location ? '<div class="meta">📍 ' + esc(note.location) + "</div>" : "";
    const images = (note.images || []).map(image => '<img class="thumb" data-image-id="' + esc(typeof image === "string" ? image : image.driveFileId || image.id) + '" alt="Imagen adjunta">').join("");
    const files = (note.files || []).map(file => '<button class="small-btn" data-a="open-file" data-id="' + id + '" data-media-id="' + esc(file.id) + '">📎 ' + esc(file.name) + "</button>").join(" ");
    const attachments = (images ? '<div class="media">' + images + "</div>" : "") + (files ? '<div class="file-line">' + files + "</div>" : "");
    const noteMeta = note.type === "note" ? '<div class="note-card-meta"><strong>' + esc(noteTitle(note)) + '</strong><span>' + esc(settingLabel(currentNoteSettings, "categories", note.noteClassification?.scope, note.noteClassification?.categoryLabel || noteClassificationLabel(note.noteClassification))) + '</span></div>' : '';
    const mediaMeta = note.mediaContext ? mediaContextCard(note) : "";
    const extra = (note.schedule ? scheduleActions(note) : note.type === "calendar" ? calendarActions(note, google) : note.type === "contact" ? contactActions(note, google) : noteMeta) + mediaMeta;
    const status = note.status === "done" ? "Reabrir" : "✓ Hecho";
    return '<article data-entry-id="' + id + '"><div class="message me"><div class="bubble">' + esc(note.text || "Entrada con adjunto") + '</div></div><div class="message angeli"><div class="avatar">A</div><div class="bubble"><span class="badge">' + esc(typeLabel(note.type)) + "</span><br>" + esc(note.proposal?.description || "Guardado en Angeli") + location + "</div></div>" + attachments + extra + '<div class="inline-actions"><button class="small-btn" data-a="toggle" data-id="' + id + '">' + status + '</button><button class="small-btn danger" data-a="delete" data-id="' + id + '">Borrar</button></div></article>';
  }

  function scheduleActions(note) {
    const schedule = note.schedule;
    if (schedule.status === "scheduled") {
      const link = schedule.calendarUrl ? ' <a class="small-btn" href="' + esc(schedule.calendarUrl) + '" target="_blank" rel="noopener">📅 Ver aviso</a>' : "";
      return '<div class="schedule-status">⏰ ' + esc(scheduleTitle(note)) + '<span>' + esc(scheduleWhen(schedule)) + '</span></div><div class="inline-actions">' + link + actionButton(note.id, "Ver aviso", "show-action") + "</div>";
    }
    if (schedule.status === "cancelled") return '<div class="schedule-status muted">Aviso cancelado</div>';
    if (schedule.status === "completed") return '<div class="schedule-status muted">✓ Pendiente completado</div>';
    return '<div class="schedule-status">⏰ ' + esc(scheduleState(schedule)) + '<span>' + esc(scheduleWhen(schedule)) + '</span></div>' + actionButton(note.id, schedule.status === "error" ? "Reintentar aviso" : "Programar aviso", "show-action");
  }

  function showImagePreview(files) {
    $("preview").innerHTML = files.map(file => '<img class="thumb" src="' + URL.createObjectURL(file) + '" alt="Imagen preparada">').join("");
  }

  // Pantalla de escucha continua en primer plano; la lógica de qué decir y
  // cuándo escuchar vive en app.js (reutiliza el mismo add() del compositor).
  function openConversationMode() {
    $("conversationModeTranscript").innerHTML = "";
    setConversationStatus("Toca el micrófono para empezar");
    $("conversationMode").classList.add("show");
    $("conversationMode").setAttribute("aria-hidden", "false");
  }

  function closeConversationMode() {
    $("conversationMode").classList.remove("show");
    $("conversationMode").setAttribute("aria-hidden", "true");
    $("conversationModeMic").classList.remove("listening");
  }

  function setConversationStatus(text) {
    $("conversationModeStatus").textContent = text;
  }

  function addConversationTurn(role, text) {
    const article = document.createElement("div");
    article.className = "message " + (role === "me" ? "me" : "angeli");
    article.innerHTML = role === "me"
      ? '<div class="bubble">' + esc(text) + "</div>"
      : '<div class="avatar">A</div><div class="bubble">' + esc(text) + "</div>";
    $("conversationModeTranscript").appendChild(article);
    $("conversationModeTranscript").scrollTop = $("conversationModeTranscript").scrollHeight;
  }

  return { $, notify, setGoogleStatus, setPushStatus, setSyncStatus, showConnectionHealth, showNotificationSettings, render, openMediaLibrary, renderMediaLibrary, closeMediaLibrary, openNoteLibrary, renderNoteLibrary, closeNoteLibrary, openDietario, renderDietario, closeDietario, showDietarioDetail, openShoppingList, closeShoppingList, renderShoppingOverview, renderShoppingDetail, renderShoppingCart, renderShoppingPurchases, showPurchaseDetail, hideShoppingSuggestions, showShoppingSuggestionsMessage, renderShoppingSuggestions, setShoppingFallback, showShoppingAddConfirm, renderShoppingConfirmResults, setShoppingConfirmStatus, showShoppingListChoice, showMediaViewer, closeMediaViewer, showMediaEntryDetail, showImagePreview, showEntryAction, showCalendarEvent, showCalendarEventEditor, showInteractionQuestion, showWhatsAppEditor, showWhatsAppPhoneEditor, showCalendarFieldEditor, showCalendarDateTimeEditor, showPendingChoices, showReminderResults, showReminderDetail, showReminderEditor, showReminderCancellation, showNoteResults, showNoteDetail, showNoteDeleteConfirmation, showNoteConfirmation, showNoteEditor, showNoteSettings, showMediaContextEditor, showCompletion, showDraft, updateDraft, showWorking, updateWorking, openModal, openMenu, closeLayers, dismissWelcome, openConversationMode, closeConversationMode, setConversationStatus, addConversationTurn };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
