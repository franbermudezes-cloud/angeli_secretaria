import { cleanTemporalText } from "./temporal.js?v=0.21.20";
import { scheduleTitle } from "./schedule.js?v=0.21.20";

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
        events: (data.items || []).filter(item => item.status !== "cancelled").map(calendarCandidate),
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
    if (!confirm("¿Cancelar definitivamente este evento?")) return;
    try {
      await calendarRequest("DELETE", `/${encodeURIComponent(eventId)}`);
      completeCalendarAction(note, eventId, "delete");
      notify("Evento cancelado");
    } catch (_) {
      notify("No se pudo cancelar");
    }
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
    createScheduledReminder,
    cancelScheduledReminder,
    completeScheduledReminder,
    searchCalendar,
    deleteCalendarEvent,
    updateCalendarEvent,
    getContactResult: id => contactResults.get(id),
    getCalendarResult: id => calendarResults.get(id),
    clearContactResult: id => contactResults.delete(id),
    contactTel
  };
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
  return {
    id: schedule.calendarEventId || `angelirem${note.id.replace(/-/g, "")}`,
    summary: scheduleTitle(note),
    description: note.text || note.aiIntent?.title || "",
    start: { dateTime: schedule.dueAt, timeZone: "Europe/Madrid" },
    end: { dateTime: calendarEnd(schedule.dueAt.slice(0, 10), schedule.dueAt.slice(11, 16)), timeZone: "Europe/Madrid" },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] }
  };
}

function contactTel(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function calendarEvent(note) {
  return {
    id: `angeli${note.id.replace(/-/g, "")}`,
    summary: (note.calendarTitle || note.aiIntent?.title || cleanTemporalText(note.text)).trim(),
    start: { dateTime: calendarDateTime(note.scheduledDate, note.scheduledTime), timeZone: "Europe/Madrid" },
    end: { dateTime: calendarEnd(note.scheduledDate, note.scheduledTime), timeZone: "Europe/Madrid" },
    ...(note.location ? { location: note.location } : {})
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
  const withoutCommand = String(value || "")
    .replace(/^\s*(?:cancela(?:r)?|borra(?:r)?|anula(?:r)?|pasa|cambia|mueve|modifica)\s+(?:la\s+|el\s+)?/i, "");
  return cleanTemporalText(withoutCommand)
    .replace(/^(?:la\s+|el\s+)?(?:(?:recordatorio|aviso)\s+(?:de|para)|(?:llamada|llamar)\s+(?:a|de|con))\s+/i, "")
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
    if (action === "delete") return reminderEvent
      ? { ...item, schedule: { ...item.schedule, status: "cancelled" } }
      : { ...item, calendarStatus: "cancelled", calendarUrl: "" };
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
