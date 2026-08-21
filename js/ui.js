import { typeLabel } from "./classifier.js?v=0.16.4";

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

  function setGoogleStatus({ contacts, calendar, ai }) {
    $("contactsStatus").textContent = contacts;
    $("calendarStatus").textContent = calendar;
    $("aiStatus").textContent = ai;
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

  function entryBody(note) {
    const description = note.proposal?.description || "Entrada guardada";
    const location = note.location ? "<br>📍 " + esc(note.location) : "";
    return '<div class="proposal-box"><strong>' + esc(typeLabel(note.type)) + "</strong>" + esc(description) + location + "</div>";
  }

  function showEntryAction(note) {
    const intent = note.proposal?.intent || "note";
    const base = { title: "Entrada preparada", lead: "Angeli ha entendido esto. Confirma solo si quieres realizar la acción.", body: entryBody(note) };
    if (intent === "calendar.create") {
      openModal({ ...base, title: "¿Lo añado al calendario?", actions: [
        { label: "Seguir editando", kind: "secondary", onClick: () => { closeLayers(); $("text").value = note.text; $("text").focus(); } },
        { label: "📅 Añadir", kind: "confirm", dataset: { a: "calendar", id: note.id } }
      ] });
      return;
    }
    if (intent === "contact.call") {
      openModal({ ...base, title: "Llamar", actions: [
        { label: "Ahora no", kind: "secondary", onClick: closeLayers },
        { label: note.phone ? "📞 Abrir marcador" : "👥 Buscar contacto", kind: "confirm", dataset: { a: note.phone ? "call" : "search-contact", id: note.id, phone: note.phone || "" } }
      ] });
      return;
    }
    if (["calendar.query", "calendar.update", "calendar.delete"].includes(intent)) {
      const label = intent === "calendar.query" ? "📅 Consultar" : "Buscar coincidencias";
      const title = intent === "calendar.query" ? "Consultar calendario" : intent === "calendar.update" ? "Modificar evento" : "Cancelar evento";
      openModal({ ...base, title, actions: [{ label: "Ahora no", kind: "secondary", onClick: closeLayers }, { label, kind: "confirm", dataset: { a: "search-calendar", id: note.id } }] });
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
    const images = (note.images || []).map(imageId => '<img class="thumb" data-image-id="' + esc(imageId) + '" alt="Imagen adjunta">').join("");
    const files = (note.files || []).map(file => '<button class="small-btn" data-a="open-file" data-id="' + id + '" data-media-id="' + esc(file.id) + '">📎 ' + esc(file.name) + "</button>").join(" ");
    const attachments = (images ? '<div class="media">' + images + "</div>" : "") + (files ? '<div class="file-line">' + files + "</div>" : "");
    const extra = note.type === "calendar" ? calendarActions(note, google) : note.type === "contact" ? contactActions(note, google) : "";
    const status = note.status === "done" ? "Reabrir" : "✓ Hecho";
    return '<article data-entry-id="' + id + '"><div class="message me"><div class="bubble">' + esc(note.text || "Entrada con adjunto") + '</div></div><div class="message angeli"><div class="avatar">A</div><div class="bubble"><span class="badge">' + esc(typeLabel(note.type)) + "</span><br>" + esc(note.proposal?.description || "Guardado en Angeli") + location + "</div></div>" + attachments + extra + '<div class="inline-actions"><button class="small-btn" data-a="toggle" data-id="' + id + '">' + status + '</button><button class="small-btn danger" data-a="delete" data-id="' + id + '">Borrar</button></div></article>';
  }

  function showImagePreview(files) {
    $("preview").innerHTML = files.map(file => '<img class="thumb" src="' + URL.createObjectURL(file) + '" alt="Imagen preparada">').join("");
  }

  return { $, notify, setGoogleStatus, render, showImagePreview, showEntryAction, openModal, openMenu, closeLayers };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
