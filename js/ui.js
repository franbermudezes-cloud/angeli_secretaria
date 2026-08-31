import { typeLabel } from "./classifier.js?v=0.21.32";
import { calendarDetails, scheduleState, scheduleTitle, scheduleWhen } from "./schedule.js?v=0.21.32";
import { noteClassificationLabel, noteTitle } from "./notes.js?v=0.21.32";

export function createUI({ getMedia }) {
  const $ = id => document.getElementById(id);
  let toastTimer;
  let completionTimer;
  const welcomeStartedAt = performance.now();
  let welcomeDismissed = false;

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
    $("actionModal").classList.remove("working-modal", "conversation-modal", "call-choice-modal");
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
    image.src = "assets/angeli-welcome.gif?v=0.21.32";
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
      const item = document.createElement(onSelect ? "button" : "div");
      if (onSelect) { item.type = "button"; item.onclick = () => onSelect(entry); }
      item.className = "contact-choice";
      const title = document.createElement("strong");
      title.textContent = entry.aiIntent?.title || entry.text || "Recordatorio";
      const when = document.createElement("span");
      when.textContent = entry.schedule ? scheduleWhen(entry.schedule) : "Pendiente";
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

  function showNoteResults(matches, query = "") {
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
      item.append(content);
      body.append(item);
    });
    openModal({ title: matches.length === 1 ? "He encontrado esta nota" : "He encontrado estas notas", lead: query ? `Relacionadas con ${query}.` : "Estas son tus notas pendientes.", body, actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
  }

  function noteConfirmationCard(note) {
    const classification = note.noteClassification || note.aiIntent?.noteClassification || {};
    const relation = classification.relationName ? '<span class="calendar-field-label">Relacionada con</span><b>' + esc(classification.relationName) + '</b>' : '';
    const purpose = classification.purpose ? '<span class="calendar-field-label">Motivo</span><b>' + esc(classification.purpose) + '</b>' : '';
    const tags = classification.tags?.length ? '<span class="calendar-field-label">Etiquetas</span><b>' + esc(classification.tags.join(" · ")) + '</b>' : '';
    return '<div class="calendar-confirmation note-confirmation"><span class="calendar-field-label">Título</span><strong>' + esc(noteTitle(note)) + '</strong><span class="calendar-field-label">Contenido</span><b>' + esc(note.text) + '</b><span class="calendar-field-label">Clasificación</span><b>' + esc(noteClassificationLabel(classification)) + '</b>' + relation + purpose + tags + '</div>';
  }

  function showNoteConfirmation(note, { onSave, onEdit, onCancel } = {}) {
    openModal({
      title: "¿Guardo esta nota?",
      lead: "Comprueba el contenido y su clasificación. Nada se guardará hasta que confirmes.",
      body: noteConfirmationCard(note),
      actions: [
        { label: "Cancelar", kind: "secondary", onClick: onCancel || closeLayers },
        { label: "Modificar", kind: "secondary", onClick: onEdit },
        { label: "Guardar nota", kind: "confirm", onClick: onSave }
      ]
    });
  }

  function showNoteEditor(note, { onSave, onCancel } = {}) {
    const classification = note.noteClassification || note.aiIntent?.noteClassification || {};
    const form = document.createElement("div");
    form.className = "note-editor";
    form.innerHTML = '<label>Título<input id="noteDraftTitle" type="text"></label>' +
      '<label>Contenido<textarea id="noteDraftText" rows="4"></textarea></label>' +
      '<label>Categoría<select id="noteDraftScope"><option value="general">General</option><option value="personal">Personal</option><option value="company">Empresa</option></select></label>' +
      '<label>Relación<select id="noteDraftRelationType"><option value="none">Sin relación</option><option value="person">Persona</option><option value="client">Cliente</option><option value="project">Proyecto</option><option value="event">Evento</option></select></label>' +
      '<label>Nombre relacionado<input id="noteDraftRelationName" type="text" placeholder="Persona, cliente, proyecto o evento"></label>' +
      '<label>Motivo<input id="noteDraftPurpose" type="text"></label>' +
      '<label>Etiquetas<input id="noteDraftTags" type="text" placeholder="Separadas por comas"></label>';
    openModal({
      title: "Modificar nota",
      lead: "Corrige únicamente lo que necesites y vuelve a revisar la ficha.",
      body: form,
      actions: [
        { label: "Volver", kind: "secondary", onClick: onCancel },
        { label: "Revisar cambios", kind: "confirm", onClick: () => onSave?.({
          title: $("noteDraftTitle").value,
          text: $("noteDraftText").value,
          scope: $("noteDraftScope").value,
          relationType: $("noteDraftRelationType").value,
          relationName: $("noteDraftRelationName").value,
          purpose: $("noteDraftPurpose").value,
          tags: $("noteDraftTags").value
        }) }
      ]
    });
    $("noteDraftTitle").value = noteTitle(note);
    $("noteDraftText").value = note.text || "";
    $("noteDraftScope").value = classification.scope || "general";
    $("noteDraftRelationType").value = classification.relationType || "none";
    $("noteDraftRelationName").value = classification.relationName || "";
    $("noteDraftPurpose").value = classification.purpose || "";
    $("noteDraftTags").value = (classification.tags || []).join(", ");
  }

  function entryBody(note) {
    const description = note.proposal?.description || "Entrada guardada";
    const location = note.location ? "<br>📍 " + esc(note.location) : "";
    return '<div class="proposal-box"><strong>' + esc(typeLabel(note.type)) + "</strong>" + esc(description) + location + "</div>";
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
      openModal({ ...base, title: note.schedule.status === "error" ? "No se pudo programar" : "¿Programo este aviso?", lead: "Comprueba el título. Si está bien, solo tienes que programarlo.", body: detail, actions: [{ label: "Cancelar", kind: "secondary", onClick: closeLayers }, { label: "Cambiar título", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "title" } }, { label: calendarDetails(note).description ? "Cambiar descripción" : "Añadir descripción", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "description" } }, { label: note.schedule.status === "error" ? "Reintentar" : "⏰ Programar", kind: "confirm", dataset: { a: "schedule", id: note.id } }] });
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
        { label: calendarDetails(note).description ? "Cambiar descripción" : "Añadir descripción", kind: "secondary", dataset: { a: "edit-calendar-field", id: note.id, field: "description" } },
        { label: "📅 Añadir", kind: "confirm", dataset: { a: "calendar", id: note.id } }
      ] });
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
    showCompletion({ title: "Guardado", lead: "La entrada se ha guardado en tu conversación." });
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
  }

  function showCalendarEvent(note, google, eventId) {
    const event = google.getCalendarResult(note.id)?.events?.find(item => item.id === eventId);
    if (!event) { showEntryAction(note, google); return; }
    openModal({title: event.summary, lead: event.when,
      body: '<p>' + (event.allDay ? 'Todo el día' : 'Inicio: ' + esc(event.when)) + '</p>' +
        (event.end ? '<p>Fin: ' + esc(event.allDay ? event.end + ' (fecha de fin exclusiva)' : new Date(event.end).toLocaleString('es-ES')) + '</p>' : ''),
      actions: [
        {label:'Volver a la agenda', kind:'soft', onClick:()=>showEntryAction(note,google)},
        {label:'Anular este evento', kind:'danger', dataset:{a:'agenda-delete',id:note.id,eventId:event.id}}
      ]});
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
      if (intent === "calendar.query") button = '<div class="inline-actions">' + eventButton(note.id, event.id, "Ver", "primary", "agenda-view") + eventButton(note.id, event.id, "Anular", "danger", "agenda-delete") + '</div>';
      if (intent === "calendar.delete") button = eventButton(note.id, event.id, "Cancelar", "danger", "calendar-delete");
      if (intent === "calendar.update") button = eventButton(note.id, event.id, "Modificar", "primary", "calendar-update");
      return '<div class="choice"><div><b>' + esc(event.summary) + "</b><span>" + esc(event.when) + "</span></div>" + button + "</div>";
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

  function render({ notes, selectedFilter, selectedType, google }) {
    document.querySelectorAll("img[data-object-url]").forEach(image => URL.revokeObjectURL(image.dataset.objectUrl));
    const query = $("search").value.toLowerCase().trim();
    const shown = notes.filter(note => {
      const matchesStatus = selectedFilter === "all" || note.status === selectedFilter;
      const matchesType = selectedType === "all" || note.type === selectedType;
      const classification = note.noteClassification || {};
      const matchesQuery = !query || [note.text, note.aiIntent?.title, classification.scope, classification.relationName, classification.purpose, ...(classification.tags || []), ...(note.files || []).map(file => file.name || file)].filter(Boolean).join(" ").toLowerCase().includes(query);
      return matchesStatus && matchesType && matchesQuery;
    });
    const cards = shown.map(note => renderCard(note, google)).join("");
    $("list").innerHTML = shown.length ? '<div class="day">Entradas recientes</div>' + cards : '<div class="empty">No hay entradas que mostrar.</div>';
    hydrateImages();
  }

  function renderCard(note, google) {
    const id = esc(note.id);
    const location = note.location ? '<div class="meta">📍 ' + esc(note.location) + "</div>" : "";
    const images = (note.images || []).map(image => '<img class="thumb" data-image-id="' + esc(typeof image === "string" ? image : image.driveFileId || image.id) + '" alt="Imagen adjunta">').join("");
    const files = (note.files || []).map(file => '<button class="small-btn" data-a="open-file" data-id="' + id + '" data-media-id="' + esc(file.id) + '">📎 ' + esc(file.name) + "</button>").join(" ");
    const attachments = (images ? '<div class="media">' + images + "</div>" : "") + (files ? '<div class="file-line">' + files + "</div>" : "");
    const noteMeta = note.type === "note" ? '<div class="note-card-meta"><strong>' + esc(noteTitle(note)) + '</strong><span>' + esc(noteClassificationLabel(note.noteClassification)) + '</span></div>' : '';
    const extra = note.schedule ? scheduleActions(note) : note.type === "calendar" ? calendarActions(note, google) : note.type === "contact" ? contactActions(note, google) : noteMeta;
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

  return { $, notify, setGoogleStatus, setSyncStatus, render, showImagePreview, showEntryAction, showCalendarEvent, showInteractionQuestion, showCalendarFieldEditor, showPendingChoices, showReminderResults, showReminderCancellation, showNoteResults, showNoteConfirmation, showNoteEditor, showCompletion, showDraft, updateDraft, showWorking, updateWorking, openModal, openMenu, closeLayers, dismissWelcome };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
