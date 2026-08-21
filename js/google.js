import { cleanTemporalText } from "./temporal.js?v=0.18.1";
import { scheduleTitle } from "./schedule.js?v=0.18.1";

const CLIENT_ID = "172772694205-7sigc4s8lkhebs4dtjjvj6huptj10tt0.apps.googleusercontent.com";
const API = "https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app";
const SCOPES = {
  identity: "openid email",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.events"
};
const CALENDAR_SEARCH_INTENTS = new Set(["calendar.query", "calendar.update", "calendar.delete"]);

export function createGoogleIntegration({ notify, refresh, setStatus, saveNotes, getNotes }) {
  let idToken = "";
  let identityExpiresAt = 0;
  let account = "";
  let scriptPromise = null;
  let links = { contacts: false, calendar: false };
  const contactResults = new Map();
  const calendarResults = new Map();
  const calendarInFlight = new Set();

  function identityValid() {
    return Boolean(idToken) && Date.now() < identityExpiresAt;
  }

  function updateStatus() {
    setStatus({
      ai: identityValid() ? `IA conectada${account ? ` · ${account}` : ""}` : "IA: elige una cuenta",
      contacts: links.contacts ? "Contactos conectados" : "Contactos: pendiente de conectar",
      calendar: links.calendar ? "Calendario conectado" : "Calendario: pendiente de conectar"
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
        callback: response => response.code ? resolve(response.code) : reject(new Error(response.error || "Google no autorizó")),
        error_callback: () => reject(new Error("Google no pudo abrir la autorización"))
      });
      client.requestCode();
    });
  }

  async function request(path, body, needsIdentity = true) {
    const headers = { "Content-Type": "application/json" };
    if (needsIdentity) headers.Authorization = `Bearer ${idToken}`;
    const response = await fetch(API + path, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Google respondió ${response.status}`);
    return response.json();
  }

  function storeIdentity(token) {
    const payload = decodeJwt(token);
    if (payload.aud !== CLIENT_ID || !payload.exp) throw new Error("La credencial de Google no es válida");
    idToken = token;
    identityExpiresAt = Number(payload.exp) * 1000 - 30000;
    account = typeof payload.email === "string" ? payload.email : "";
  }

  async function syncLinks() {
    if (!identityValid()) return updateStatus();
    try {
      links = await request("/session/status", {});
    } catch (_) {
      // La identidad puede ser válida aunque el estado remoto no esté disponible.
    }
    updateStatus();
  }

  async function connectAI() {
    if (identityValid()) return true;
    try {
      const code = await requestCode("identity");
      const data = await request("/oauth/exchange", { integration: "identity", code, redirectUri: location.origin }, false);
      storeIdentity(data.idToken);
      await syncLinks();
      notify("IA conectada");
      return true;
    } catch (_) {
      idToken = "";
      identityExpiresAt = 0;
      account = "";
      updateStatus();
      notify("No se pudo conectar la IA");
      return false;
    }
  }

  async function connectPersistent(kind) {
    if (!identityValid() && !(await connectAI())) return false;
    try {
      const code = await requestCode(kind);
      await request("/oauth/exchange", { integration: kind, code, redirectUri: location.origin });
      links = { ...links, [kind]: true };
      updateStatus();
      notify(`${kind === "contacts" ? "Contactos" : "Calendario"} conectado de forma permanente`);
      return true;
    } catch (_) {
      notify("No se pudo guardar la conexión");
      return false;
    }
  }

  const connectContacts = () => connectPersistent("contacts");
  const connectCalendar = () => connectPersistent("calendar");

  async function callApi(body) {
    if (!identityValid() && !(await connectAI())) throw new Error("IA no conectada");
    return request("/google", body);
  }

  async function interpretWithAI(text, provider) {
    if (!identityValid() && !(await connectAI())) throw new Error("IA no conectada");
    return provider(text, idToken);
  }

  function disconnectAI() {
    idToken = "";
    identityExpiresAt = 0;
    account = "";
    updateStatus();
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
        calendarUrl: saved.htmlLink || ""
      } : item));
      notify("Evento añadido al calendario");
    } catch (_) {
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
      const saved = await calendarRequest("POST", "", {
        id: schedule.calendarEventId || `angelirem${note.id.replace(/-/g, "")}`,
        summary: scheduleTitle(note),
        start: { dateTime: schedule.dueAt, timeZone: "Europe/Madrid" },
        end: { dateTime: calendarEnd(schedule.dueAt.slice(0, 10), schedule.dueAt.slice(11, 16)), timeZone: "Europe/Madrid" },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] }
      });
      saveNotes(getNotes().map(item => item.id === note.id ? {
        ...item,
        schedule: { ...item.schedule, status: "scheduled", calendarEventId: saved.id, calendarUrl: saved.htmlLink || "" }
      } : item));
      notify("Aviso programado en Calendar");
    } catch (_) {
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

  async function searchCalendar(note) {
    if (!CALENDAR_SEARCH_INTENTS.has(note.proposal?.intent)) return;
    try {
      const interpretation = note.aiIntent || {};
      const target = interpretation.target || {};
      const range = calendarRange(target.date || null, interpretation.rangeStart, interpretation.rangeEnd);
      const params = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "20",
        timeMin: range.from.toISOString(),
        timeMax: range.to.toISOString()
      });
      if (target.title || interpretation.title) params.set("q", target.title || interpretation.title);
      const data = await calendarRequest("GET", `?${params}`);
      calendarResults.set(note.id, { events: (data.items || []).filter(item => item.status !== "cancelled").map(calendarCandidate) });
    } catch (_) {
      calendarResults.set(note.id, { events: [], error: "No se pudo consultar Calendar" });
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
    saveNotes(getNotes().map(item => {
      if (item.id === note.id) return { ...item, proposal: { ...item.proposal, actionStatus: "completed" } };
      if (item.calendarEventId !== eventId) return item;
      if (action === "delete") return { ...item, calendarStatus: "cancelled", calendarUrl: "" };
      return {
        ...item,
        calendarStatus: "synced",
        calendarUrl: saved?.htmlLink || item.calendarUrl || "",
        ...(changes?.location ? { location: changes.location } : {}),
        ...(changes?.date ? { scheduledDate: changes.date } : {}),
        ...(changes?.time ? { scheduledTime: changes.time } : {})
      };
    }));
    refresh();
  }

  return {
    updateStatus,
    connectContacts,
    connectCalendar,
    connectAI,
    disconnectContacts,
    disconnectCalendar,
    disconnectAI,
    interpretWithAI,
    searchContact,
    createCalendarEvent,
    createScheduledReminder,
    cancelScheduledReminder,
    searchCalendar,
    deleteCalendarEvent,
    updateCalendarEvent,
    getContactResult: id => contactResults.get(id),
    getCalendarResult: id => calendarResults.get(id),
    clearContactResult: id => contactResults.delete(id),
    contactTel
  };
}

function decodeJwt(token) {
  const part = String(token || "").split(".")[1];
  if (!part) throw new Error("Credencial no válida");
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
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
