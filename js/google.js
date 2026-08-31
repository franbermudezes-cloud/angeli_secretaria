import { cleanTemporalText } from "./temporal.js?v=0.21.36";
import { calendarDetails } from "./schedule.js?v=0.21.36";
import { semanticCalendarTarget } from "./ai.js?v=0.21.36";

const CLIENT_ID = "172772694205-7sigc4s8lkhebs4dtjjvj6huptj10tt0.apps.googleusercontent.com";
const API = "https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app";
const SCOPES = {
  identity: "openid email",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  drive: "https://www.googleapis.com/auth/drive.file",
};
const CALENDAR_SEARCH_INTENTS = new Set(["calendar.query", "calendar.update", "calendar.delete"]);

export function createGoogleIntegration({ notify, refresh, setStatus, saveNotes, getNotes, getAuthToken, getSession }) {
  let scriptPromise = null;
  let links = { contacts: false, calendar: false, drive: false };
  const contactResults = new Map();
  const calendarResults = new Map();
  const calendarInFlight = new Set();

  const signedIn = () => Boolean(getSession?.().signedIn);

  function updateStatus() {
    const session = getSession?.() || {};
    const identityText = signedIn()
      ? `Sesión iniciada${session.email ? ` · ${session.email}` : ""}`
      : "Inicia sesión para sincronizar e interpretar";
    setStatus({
      app: identityText,
      contacts: links.contacts ? "Contactos conectados de forma permanente" : signedIn() ? "Contactos: pendiente de conectar" : "Inicia sesión en Angeli primero",
      calendar: links.calendar ? "Calendario conectado de forma permanente" : signedIn() ? "Calendario: pendiente de conectar" : "Inicia sesión en Angeli primero",
      drive: links.drive ? "Drive conectado de forma permanente" : signedIn() ? "Drive: pendiente de conectar" : "Inicia sesión en Angeli primero"
    });
  }

  function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("No se pudo iniciar Google"));
      document.head.append(script);
    });
    return scriptPromise;
  }

  async function requestCode(kind) {
    await loadGoogleIdentity();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initCodeClient({
        client_id: CLIENT_ID,
        scope: SCOPES[kind],
        ux_mode: "popup",
        prompt: kind === "identity" ? "select_account" : "consent select_account",
        callback: response => response.code ? resolve(response.code) : reject(new Error(response.error || "Google no autorizó")),
        error_callback: () => reject(new Error("Google no pudo abrir la autorización"))
      });
      client.requestCode();
    });
  }

  async function request(path, body) {
    const headers = { "Content-Type": "application/json" };
    headers.Authorization = `Bearer ${await getAuthToken()}`;
    const response = await fetch(API + path, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Google respondió ${response.status}`);
    return data;
  }

  async function syncLinks() {
    if (!signedIn()) return updateStatus();
    try {
      links = await request("/session/status", {});
    } catch (_) {
      // La identidad puede ser válida aunque el estado remoto no esté disponible.
    }
    updateStatus();
  }

  async function connectPersistent(kind) {
    if (!signedIn()) { notify("Inicia sesión en Angeli antes de conectar Google"); return false; }
    try {
      const code = await requestCode(kind);
      await request("/oauth/exchange", { integration: kind, code, redirectUri: location.origin });
      if (kind === "drive") {
        await syncLinks();
        if (!links.drive) {
          notify("Drive necesita sus carpetas fijas configuradas");
          return false;
        }
      } else {
        // Contactos y Calendar conservan su flujo ya validado: el estado
        // visual inmediato no depende de una segunda petición al servidor.
        links = { ...links, [kind]: true };
      }
      updateStatus();
      notify(`${kind === "contacts" ? "Contactos" : kind === "calendar" ? "Calendario" : "Drive"} conectado de forma permanente`);
      return true;
    } catch (error) {
      notify(`No se pudo guardar la conexión: ${error.message}`);
      return false;
    }
  }

  const connectContacts = () => connectPersistent("contacts");
  const connectCalendar = () => connectPersistent("calendar");
  async function connectDrive() {
    await syncLinks();
    if (links.drive) notify("Drive está listo: fotos y archivos irán a sus carpetas fijas");
    else return connectPersistent("drive");
    return true;
  }
  async function ensureDrive() { return links.drive || connectDrive(); }

  async function callApi(body) {
    if (!signedIn()) throw new Error("Sesión de Angeli no iniciada");
    return request("/google", body);
  }

  async function interpretWithAI(text, provider, context = null) {
    if (!signedIn()) throw new Error("Sesión de Angeli no iniciada");
    return provider(text, await getAuthToken(), context);
  }

  function disconnectContacts() {
    contactResults.clear();
    notify("Contactos siguen vinculados de forma segura en Google Cloud");
    refresh();
  }

  function disconnectCalendar() {
    calendarResults.clear();
    notify("Calendario sigue vinculado de forma segura en Google Cloud");
    refresh();
  }

  function disconnectDrive() {
    notify("Drive sigue vinculado de forma segura en Google Cloud");
    refresh();
  }

  async function searchContact(note) {
    if (!note.contactQuery) {
      notify("No hay un nombre de contacto para buscar");
      return;
    }
    if (!links.contacts && !(await connectContacts())) return;
    try {
      const data = await callApi({ integration: "contacts", action: "search", query: note.contactQuery });
      const contacts = (data.results || []).map(result => ({
        name: result.person?.names?.[0]?.displayName || note.contactQuery,
        phones: (result.person?.phoneNumbers || []).map(phone => phone.value).filter(Boolean)
      }));
      contactResults.set(note.id, { contacts });
    } catch (_) {
      contactResults.set(note.id, { contacts: [], error: "No se pudieron consultar contactos" });
    }
    refresh();
  }

  async function calendarRequest(method, path, eventBody) {
    if (!links.calendar && !(await connectCalendar())) throw new Error("Calendario no conectado");
    const eventId = path.startsWith("/") ? decodeURIComponent(path.slice(1)) : null;
    const action = method === "POST" ? "create" : method === "GET" ? "list" : method === "DELETE" ? "delete" : "patch";
    const payload = {
      integration: "calendar",
      action,
      ...(eventId ? { eventId } : {}),
      ...(action === "list" ? { params: Object.fromEntries(new URLSearchParams(path.slice(1))) } : { event: eventBody })
    };
    return callApi(payload);
  }

  async function calendarEventStatus(eventId) {
    if (!links.calendar && !(await connectCalendar())) throw new Error("Calendario no conectado");
    return callApi({ integration: "calendar", action: "get", eventId });
  }

  async function reconcileScheduledReminders(entries) {
    const linked = entries.filter(item => item?.schedule?.status === "scheduled"
      && item.schedule?.calendarEventId);
    if (!linked.length) return entries;
    const statuses = new Map();
    await Promise.all(linked.map(async item => {
      const result = await calendarEventStatus(item.schedule.calendarEventId);
      statuses.set(item.schedule.calendarEventId, result);
    }));
    return reconcileReminderEntries(entries, statuses);
  }

  async function createCalendarEvent(note) {
    if (note.calendarStatus === "synced" || !note.scheduledDate || !note.scheduledTime || calendarInFlight.has(note.id)) return;
    calendarInFlight.add(note.id);
    try {
      const saved = await calendarRequest("POST", "", calendarEvent(note));
      saveNotes(getNotes().map(item => item.id === note.id ? {
        ...item,
        calendarStatus: "synced",
        calendarEventId: saved.id,
        calendarId: saved.calendarId || "primary",
        calendarUrl: saved.htmlLink || ""
      } : item));
      notify("Evento añadido al calendario");
    } catch (_) {
      saveNotes(getNotes().map(item => item.id === note.id ? { ...item, calendarStatus: "error" } : item));
      notify("No se pudo añadir el evento");
    } finally {
      calendarInFlight.delete(note.id);
    }
  }

  async function createScheduledReminder(note) {
    const schedule = note.schedule;
    if (!schedule?.dueAt || calendarInFlight.has(note.id)) return;
    calendarInFlight.add(note.id);
    try {
      const saved = await calendarRequest("POST", "", scheduledReminderEvent(note));
      saveNotes(getNotes().map(item => item.id === note.id ? {
        ...item,
        schedule: { ...item.schedule, status: "scheduled", calendarEventId: saved.id, calendarId: saved.calendarId || "primary", calendarUrl: saved.htmlLink || "" }
      } : item));
      notify("Aviso programado en Calendar");
    } catch (_) {
      saveNotes(getNotes().map(item => item.id === note.id ? { ...item, schedule: { ...item.schedule, status: "error", lastError: "Calendar no pudo programar el aviso" } } : item));
      notify("No se pudo programar el aviso");
    } finally {
      calendarInFlight.delete(note.id);
    }
  }

  async function createLinkedCalendarBundle(note) {
    if (!note.schedule?.dueAt || calendarInFlight.has(note.id)) return;
    calendarInFlight.add(note.id);
    let event = null;
    try {
      event = await calendarRequest("POST", "", calendarEvent(note));
      const schedule = { ...note.schedule, relatedEventId: event.id };
      const reminder = await calendarRequest("POST", "", scheduledReminderEvent({ ...note, schedule }));
      saveNotes(getNotes().map(item => item.id === note.id ? {
        ...item,
        calendarStatus: "synced", calendarEventId: event.id, calendarId: event.calendarId || "primary", calendarUrl: event.htmlLink || "",
        schedule: { ...item.schedule, status: "scheduled", relatedEventId: event.id, calendarEventId: reminder.id, calendarId: reminder.calendarId || "primary", calendarUrl: reminder.htmlLink || "", lastError: null }
      } : item));
      notify("Evento y aviso añadidos a Calendar");
    } catch (_) {
      let rollbackFailed = false;
      if (event?.id) { try { await calendarRequest("DELETE", `/${encodeURIComponent(event.id)}`); } catch (_) { rollbackFailed = true; } }
      saveNotes(getNotes().map(item => item.id === note.id ? {
        ...item,
        calendarStatus: rollbackFailed ? "partial" : "error",
        ...(rollbackFailed ? { calendarEventId: event.id, calendarId: event.calendarId || "primary", calendarUrl: event.htmlLink || "" } : {}),
        schedule: { ...item.schedule, status: "error", lastError: rollbackFailed ? "El evento se creó, pero fallaron el aviso y su retirada" : "Calendar no pudo crear la operación completa" }
      } : item));
      notify(rollbackFailed ? "El evento quedó creado; revisa Calendar antes de reintentar" : "No se pudo crear el evento con su aviso");
    } finally {
      calendarInFlight.delete(note.id);
    }
  }

  async function cancelScheduledReminder(note) {
    try {
      if (note.schedule?.calendarEventId) await calendarRequest("DELETE", `/${encodeURIComponent(note.schedule.calendarEventId)}`);
      saveNotes(getNotes().map(item => item.id === note.id ? {
        ...item,
        schedule: { ...item.schedule, status: "cancelled" }
      } : item));
      notify("Aviso cancelado");
    } catch (_) {
      notify("No se pudo cancelar");
    }
  }

  async function completeScheduledReminder(note) {
    const eventId = note.schedule?.calendarEventId;
    if (!eventId) return;
    await calendarRequest("DELETE", `/${encodeURIComponent(eventId)}`);
  }

  async function searchCalendar(note) {
    if (!CALENDAR_SEARCH_INTENTS.has(note.proposal?.intent)) return;
    try {
      const interpretation = note.aiIntent || {};
      const search = buildCalendarSearch(interpretation, note.proposal?.intent);
      const data = await listAllCalendarPages(params => calendarRequest("GET", `?${params}`), search.params);
      calendarResults.set(note.id, {
        events: calendarEventsForIntent(data.items || [], note.proposal?.intent),
        calendarId: data.calendarId || "primary",
        range: search.range,
        query: search.query
      });
    } catch (error) {
      calendarResults.set(note.id, { events: [], error: `No se pudo consultar Calendar: ${error.message || "error desconocido"}` });
    }
    refresh();
  }

  async function deleteCalendarEvent(note, eventId) {
    const localBundle = getNotes().some(item => item.calendarEventId === eventId && item.schedule?.relatedEventId === eventId && item.schedule?.calendarEventId);
    if (!confirm(localBundle ? "¿Cancelar definitivamente este evento y su aviso asociado?" : "¿Cancelar definitivamente este evento?")) return;
    try {
      const linked = await linkedReminderEvents(eventId);
      await calendarRequest("DELETE", `/${encodeURIComponent(eventId)}`);
      for (const reminder of linked) await calendarRequest("DELETE", `/${encodeURIComponent(reminder.id)}`);
      completeCalendarAction(note, eventId, "delete");
      notify(linked.length ? "Evento y aviso cancelados" : "Evento cancelado");
    } catch (_) {
      notify("No se pudo completar la cancelación");
    }
  }

  async function linkedReminderEvents(eventId) {
    const params = linkedReminderSearch(eventId);
    const data = await listAllCalendarPages(page => calendarRequest("GET", `?${page}`), params);
    return (data.items || []).filter(item => item.status !== "cancelled");
  }

  async function updateCalendarEvent(note, eventId) {
    const event = calendarResults.get(note.id)?.events?.find(item => item.id === eventId);
    const changes = note.aiIntent?.changes;
    if (!event || !changes) return;
    try {
      const saved = await calendarRequest("PATCH", `/${encodeURIComponent(eventId)}`, calendarPatch(event, changes));
      completeCalendarAction(note, eventId, "update", saved, changes);
      notify("Evento actualizado");
    } catch (_) {
      notify("No se pudo actualizar");
    }
  }

  function completeCalendarAction(note, eventId, action, saved, changes) {
    calendarResults.delete(note.id);
    saveNotes(applyCalendarUpdateToEntries(getNotes(), note, eventId, action, saved, changes));
    refresh();
  }

  return {
    updateStatus,
    syncLinks,
    connectContacts,
    connectCalendar,
    connectDrive,
    ensureDrive,
    disconnectContacts,
    disconnectCalendar,
    disconnectDrive,
    interpretWithAI,
    searchContact,
    createCalendarEvent,
    createLinkedCalendarBundle,
    createScheduledReminder,
    cancelScheduledReminder,
    completeScheduledReminder,
    reconcileScheduledReminders,
    searchCalendar,
    deleteCalendarEvent,
    updateCalendarEvent,
    getContactResult: id => contactResults.get(id),
    getCalendarResult: id => calendarResults.get(id),
    clearContactResult: id => contactResults.delete(id),
    contactTel
  };
}

export function reconcileReminderEntries(entries, statuses) {
  return entries.map(entry => {
    const eventId = entry.schedule?.calendarEventId;
    if (!eventId || !statuses.has(eventId)) return entry;
    const status = statuses.get(eventId);
    const exists = typeof status === "boolean" ? status : status?.exists;
    if (exists === false) return {
      ...entry,
      status: "done",
      interaction: { ...(entry.interaction || {}), status: "cancelled", updatedAt: new Date().toISOString() },
      schedule: { ...entry.schedule, status: "cancelled", externalChange: true }
    };
    const event = status?.event;
    const dueAt = calendarEventDueAt(event);
    if (!event || !dueAt) return entry;
    const title = String(event.summary || entry.schedule.title || "Recordatorio").trim();
    const description = String(event.description || "").trim();
    const date = dueAt.slice(0, 10);
    const time = dueAt.slice(11, 16);
    const calendarUrl = String(event.htmlLink || entry.schedule.calendarUrl || "");
    if (entry.schedule.dueAt === dueAt && entry.schedule.title === title
      && String(entry.schedule.description || "") === description
      && String(entry.schedule.calendarUrl || "") === calendarUrl) return entry;
    return {
      ...entry,
      scheduledDate: date,
      scheduledTime: time,
      aiIntent: { ...(entry.aiIntent || {}), title, date, time, notes: description || null },
      schedule: {
        ...entry.schedule,
        status: "scheduled",
        dueAt,
        title,
        description,
        calendarUrl,
        externalChange: true,
        externalUpdatedAt: event.updated || new Date().toISOString()
      }
    };
  });
}

function calendarEventDueAt(event) {
  const value = event?.start?.dateTime;
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// Google puede devolver menos eventos que maxResults y continuar mediante
// nextPageToken. Nunca presentar una página parcial como si fuera toda la agenda.
export async function listAllCalendarPages(requestPage, initialParams, maxPages = 50) {
  const params = new URLSearchParams(initialParams);
  const items = [];
  let calendarId = "primary";
  for (let page = 0; page < maxPages; page++) {
    const data = await requestPage(params);
    items.push(...(Array.isArray(data.items) ? data.items : []));
    calendarId = data.calendarId || calendarId;
    if (!data.nextPageToken) return { ...data, calendarId, items, nextPageToken: undefined };
    params.set("pageToken", data.nextPageToken);
  }
  throw new Error("Calendar devolvió demasiadas páginas; concreta un periodo más corto");
}

// Constructor compartido por la PWA y la prueba real de Calendar.
export function scheduledReminderEvent(note) {
  const schedule = note.schedule;
  const details = note.proposal?.intent === "calendar.create"
    ? { title: schedule.title || "Recordatorio", description: schedule.description || "", location: "" }
    : calendarDetails(note);
  return {
    id: schedule.calendarEventId || `angelirem${note.id.replace(/-/g, "")}`,
    summary: details.title,
    description: details.description,
    start: { dateTime: schedule.dueAt, timeZone: "Europe/Madrid" },
    end: { dateTime: calendarEnd(schedule.dueAt.slice(0, 10), schedule.dueAt.slice(11, 16)), timeZone: "Europe/Madrid" },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    ...(details.location ? { location: details.location } : {}),
    ...(schedule.relatedEventId ? { extendedProperties: { private: { angeliRelatedEventId: schedule.relatedEventId } } } : {})
  };
}

function contactTel(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

export function calendarEvent(note) {
  const details = calendarDetails(note);
  return {
    id: `angeli${note.id.replace(/-/g, "")}`,
    summary: details.title || cleanTemporalText(note.text).trim(),
    start: { dateTime: calendarDateTime(note.scheduledDate, note.scheduledTime), timeZone: "Europe/Madrid" },
    end: { dateTime: calendarEnd(note.scheduledDate, note.scheduledTime), timeZone: "Europe/Madrid" },
    ...(details.location ? { location: details.location } : {}),
    ...(details.description ? { description: details.description } : {})
  };
}

function calendarDateTime(date, time) {
  return `${date}T${time}:00`;
}

function calendarEnd(date, time) {
  const value = new Date(calendarDateTime(date, time));
  value.setHours(value.getHours() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:00`;
}

function calendarRange(date, rangeStart, rangeEnd) {
  if (rangeStart && rangeEnd) return { from: new Date(`${rangeStart}T00:00:00`), to: new Date(`${rangeEnd}T00:00:00`) };
  const from = new Date(`${date || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + (date ? 1 : 90));
  return { from, to };
}

// Calendar distingue una consulta de rango ("¿qué tengo mañana?") de una
// búsqueda de un evento concreto. La primera jamás debe mandar la pregunta
// completa como `q`, porque Google la interpreta como texto del título y deja
// fuera todos los eventos reales.
export function buildCalendarSearch(interpretation = {}, intent = "calendar.query") {
  const target = interpretation.target || {};
  const range = calendarRange(target.date || null, interpretation.rangeStart, interpretation.rangeEnd);
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
    timeMin: range.from.toISOString(),
    timeMax: range.to.toISOString()
  });
  const query = intent === "calendar.query" ? "" : calendarTargetQuery(target.title);
  if (query) params.set("q", query);
  return {
    params,
    query,
    range: { from: params.get("timeMin"), to: params.get("timeMax") }
  };
}

function calendarTargetQuery(value) {
  const withoutCommand = semanticCalendarTarget(String(value || "")
    .replace(/^\s*(?:cancela(?:r)?|borra(?:r)?|anula(?:r)?|pasa|cambia|mueve|modifica)\s+(?:la\s+|el\s+)?/i, ""));
  return cleanTemporalText(withoutCommand)
    // Calendar no conoce nuestros sinónimos. "cita con Miguel" debe poder
    // encontrar "Quedada con Miguel": la categoría expresa el tipo de evento
    // y el nombre es el criterio distintivo que Google debe buscar.
    .replace(/^(?:la\s+|el\s+)?(?:recordatorio|aviso|evento|cita|quedada|llamada|llamar|cena|comida|reuni[oó]n)\s*(?:(?:a|de|del|para|con|en)\s+)?/i, "")
    .replace(/\b(?:de|del|el|la)\s+(?=con\b)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function applyCalendarUpdateToEntries(entries, note, eventId, action, saved, changes = {}) {
  return entries.map(item => {
    if (item.id === note.id) return { ...item, proposal: { ...item.proposal, actionStatus: "completed" } };
    const directEvent = item.calendarEventId === eventId;
    const reminderEvent = item.schedule?.calendarEventId === eventId;
    if (!directEvent && !reminderEvent) return item;
    if (action === "delete") {
      if (reminderEvent) return { ...item, schedule: { ...item.schedule, status: "cancelled" } };
      if (directEvent) return { ...item, calendarStatus: "cancelled", calendarUrl: "", ...(item.schedule?.relatedEventId === eventId ? { schedule: { ...item.schedule, status: "cancelled", calendarUrl: "" } } : {}) };
    }
    const date = changes.date || item.scheduledDate || item.schedule?.dueAt?.slice(0, 10);
    const time = changes.time || item.scheduledTime || item.schedule?.dueAt?.slice(11, 16);
    return {
      ...item,
      ...(directEvent ? { calendarStatus: "synced", calendarUrl: saved?.htmlLink || item.calendarUrl || "" } : {}),
      ...(changes.location ? { location: changes.location } : {}),
      ...(changes.date ? { scheduledDate: changes.date } : {}),
      ...(changes.time ? { scheduledTime: changes.time } : {}),
      ...(reminderEvent && date && time ? { schedule: { ...item.schedule, status: "scheduled", dueAt: `${date}T${time}:00` } } : {})
    };
  });
}

function calendarCandidate(event) {
  const start = event.start?.dateTime || event.start?.date || "";
  return {
    id: event.id,
    summary: event.summary || "Sin título",
    start,
    end: event.end?.dateTime || event.end?.date || "",
    when: new Date(start).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }),
    allDay: !event.start?.dateTime
  };
}

export function linkedReminderSearch(eventId) {
  return new URLSearchParams({
    singleEvents: "true",
    maxResults: "20",
    privateExtendedProperty: `angeliRelatedEventId=${eventId}`
  });
}

export function calendarEventsForIntent(items = [], intent = "calendar.query") {
  return items
    .filter(item => item.status !== "cancelled")
    .filter(item => !["calendar.delete", "calendar.update"].includes(intent) || !item.extendedProperties?.private?.angeliRelatedEventId)
    .map(calendarCandidate);
}

function calendarPatch(event, changes) {
  const result = {};
  if (changes.title) result.summary = changes.title;
  if (changes.location) result.location = changes.location;
  if (changes.notes) result.description = changes.notes;
  if (changes.date || changes.time) {
    const date = changes.date || event.start.slice(0, 10);
    const time = changes.time || event.start.slice(11, 16);
    result.start = { dateTime: calendarDateTime(date, time), timeZone: "Europe/Madrid" };
    result.end = { dateTime: calendarEnd(date, time), timeZone: "Europe/Madrid" };
  }
  return result;
}
