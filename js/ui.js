import { typeLabel } from "./classifier.js?v=0.20.5";
import { scheduleState, scheduleTitle, scheduleWhen } from "./schedule.js?v=0.20.5";

export function createUI({ getMedia }) {
  const $ = id => document.getElementById(id);
  let toastTimer;

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
    $("actionModal").classList.remove("show");
    $("settingsMenu").classList.remove("show");
    $("scrim").classList.remove("show");
  }

  function openMenu() {
    $("scrim").classList.add("show");
    $("settingsMenu").classList.add("show");
  }

  function openModal({ title, lead, body, actions = [] }) {
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

  function showDraft({ value = "", onInput, onSend, onCancel }) {
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
        { label: "➤ Enviar", kind: "confirm", onClick: onSend }
      ]
    });
    setTimeout(() => draft.focus(), 0);
  }

  function updateDraft(value) {
    const draft = $("activeDraft");
    if (draft && draft.value !== value) draft.value = value;
  }

  function showWorking(title, lead, body) {
    openModal({ title, lead, body, actions: [] });
  }

  function updateWorking(title, lead, body) {
    if (!$("actionModal").classList.contains("show")) return showWorking(title, lead, body);
    $("modalTitle").textContent = title;
    $("modalLead").textContent = lead;
    $("modalBody").textContent = body || "";
    $("modalActions").innerHTML = "";
  }

  function entryBody(note) {
    const description = note.proposal?.description || "Entrada guardada";
    const location = note.location ? "<br>📍 " + esc(note.location) : "";
    return '<div class="proposal-box"><strong>' + esc(typeLabel(note.type)) + "</strong>" + esc(description) + location + "</div>";
  }

  function showEntryAction(note, google) {
    const intent = note.proposal?.intent || "note";
    const base = { title: "Entrada preparada", lead: "Angeli ha entendido esto. Confirma solo si quieres realizar la acción.", body: entryBody(note) };
    if (note.schedule) {
      const title = scheduleTitle(note), when = scheduleWhen(note.schedule);
      const detail = entryBody(note) + '<div class="schedule-box"><strong>⏰ ' + esc(title) + '</strong><span>' + esc(when) + '</span><small>Estado: ' + esc(scheduleState(note.schedule)) + '</small></div>';
      if (note.schedule.status === "scheduled") {
        const link = note.schedule.calendarUrl ? '<p><a href="' + esc(note.schedule.calendarUrl) + '" target="_blank" rel="noopener">Abrir aviso en Calendar</a></p>' : "";
        openModal({ ...base, title: "✓ Aviso programado", lead: "Calendar te avisará a la hora indicada.", body: detail + link, actions: [{ label: "Cancelar aviso", kind: "secondary", dataset: { a: "cancel-schedule", id: note.id } }, { label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
        return;
      }
      if (note.schedule.status === "cancelled") {
        openModal({ ...base, title: "Aviso cancelado", lead: "La entrada sigue guardada, pero ya no habrá aviso.", body: detail, actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
        return;
      }
      openModal({ ...base, title: note.schedule.status === "error" ? "No se pudo programar" : "¿Programo este aviso?", lead: "Se creará un aviso en Google Calendar para que Android te avise a la hora indicada.", body: detail, actions: [{ label: "Ahora no", kind: "secondary", onClick: closeLayers }, { label: note.schedule.status === "error" ? "Reintentar" : "⏰ Programar", kind: "confirm", dataset: { a: "schedule", id: note.id } }] });
      return;
    }
    if (intent === "calendar.create") {
      if (note.calendarStatus === "synced") {
        const link = note.calendarUrl ? '<p><a href="' + esc(note.calendarUrl) + '" target="_blank" rel="noopener">Abrir evento en Calendar</a></p>' : "";
        openModal({ ...base, title: "✓ Añadido al calendario", lead: "El evento ya está creado.", body: entryBody(note) + link, actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
        return;
      }
      openModal({ ...base, title: "¿Lo añado al calendario?", actions: [
        { label: "Seguir editando", kind: "secondary", onClick: () => { closeLayers(); $("text").value = note.text; $("text").focus(); } },
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
      openModal({ ...base, title: "Llamar", actions: [
        { label: "Ahora no", kind: "secondary", onClick: closeLayers },
        { label: note.phone ? "📞 Abrir marcador" : "👥 Buscar contacto", kind: "confirm", dataset: { a: note.phone ? "call" : "search-contact", id: note.id, phone: note.phone || "" } }
      ] });
      return;
    }
    if (["calendar.query", "calendar.update", "calendar.delete"].includes(intent)) {
      const label = intent === "calendar.query" ? "📅 Consultar" : "Buscar coincidencias";
      const title = intent === "calendar.query" ? "Consultar calendario" : intent === "calendar.update" ? "Modificar evento" : "Cancelar evento";
      const result = google?.getCalendarResult(note.id);
      const body = result ? entryBody(note) + calendarActions(note, google) : base.body;
      openModal({ ...base, title, body, actions: result ? [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] : [{ label: "Ahora no", kind: "secondary", onClick: closeLayers }, { label, kind: "confirm", dataset: { a: "search-calendar", id: note.id } }] });
      return;
    }
    openModal({ ...base, title: "Guardado", lead: "La entrada se ha guardado en tu conversación.", actions: [{ label: "Cerrar", kind: "confirm", onClick: closeLayers }] });
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
      const matchesQuery = !query || (note.text + " " + (note.files || []).map(file => file.name || file).join(" ")).toLowerCase().includes(query);
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
    const extra = note.schedule ? scheduleActions(note) : note.type === "calendar" ? calendarActions(note, google) : note.type === "contact" ? contactActions(note, google) : "";
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
    return '<div class="schedule-status">⏰ ' + esc(scheduleState(schedule)) + '<span>' + esc(scheduleWhen(schedule)) + '</span></div>' + actionButton(note.id, schedule.status === "error" ? "Reintentar aviso" : "Programar aviso", "show-action");
  }

  function showImagePreview(files) {
    $("preview").innerHTML = files.map(file => '<img class="thumb" src="' + URL.createObjectURL(file) + '" alt="Imagen preparada">').join("");
  }

  return { $, notify, setGoogleStatus, setSyncStatus, render, showImagePreview, showEntryAction, showDraft, updateDraft, showWorking, updateWorking, openModal, openMenu, closeLayers };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
