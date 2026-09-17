import { cleanTemporalText } from "./temporal.js?v=0.21.71";
import { calendarDetails } from "./schedule.js?v=0.21.71";
import { semanticCalendarTarget } from "./ai.js?v=0.21.71";

const CLIENT_ID = "172772694205-7sigc4s8lkhebs4dtjjvj6huptj10tt0.apps.googleusercontent.com";
const API = "https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app";
const SCOPES = {
  identity: "openid email",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  drive: "https://www.googleapis.com/auth/drive.file",
};
const CALENDAR_SEARCH_INTENTS = new Set(["calendar.query", "calendar.update", "calendar.delete"]);
const INTEGRATIONS = ["ai", "contacts", "calendar", "drive"];
const LABELS = { ai: "IA", contacts: "Contactos", calendar: "Calendar", drive: "Drive" };
const DISCONNECTED = { state: "disconnected", reason: "missing_grant" };

export function normalizeConnectionReport(report = {}, signedIn = true) {
  const normalized = {};
  for (const integration of INTEGRATIONS) {
    const value = report?.[integration];
    if (!signedIn) normalized[integration] = { state: "disconnected", reason: "session_required" };
    else if (typeof value === "boolean") normalized[integration] = value ? { state: "connected", reason: "legacy" } : { ...DISCONNECTED };
    else if (value && ["connected", "disconnected", "reconnect_required", "permission_required", "unavailable", "checking"].includes(value.state)) normalized[integration] = value;
    else normalized[integration] = { state: "unavailable", reason: "invalid_response" };
  }
  return normalized;
}

export function connectionProblems(report) {
  return INTEGRATIONS.filter(integration => report?.[integration]?.state !== "connected")
    .map(integration => ({ integration, label: LABELS[integration], ...report[integration] }));
}

export function connectionStatusText(integration, status, signedIn = true) {
  const label = LABELS[integration];
  if (status?.state === "checking") return `${label}: comprobando…`;
  if (status?.state === "connected") return integration === "ai" ? "Sesión de Angeli conectada y comprobada"
    : integration === "contacts" ? "Contactos conectados y comprobados" : `${label} conectado y comprobado`;
  if (!signedIn || status?.reason === "session_required") return integration === "ai" ? "IA: no conectada" : "Inicia sesión en Angeli primero";
  if (status?.state === "permission_required") return `${label}: faltan permisos`;
  if (status?.state === "unavailable") return `${label}: no se pudo comprobar`;
  return `${label}: no conectado`;
}

export function integrationFailureMessage(integration, error, fallback = "No se pudo completar la operación") {
  const label = LABELS[integration] || "Google";
  if (error?.code === "session_required") return "La sesión de Angeli ha caducado. Inicia sesión de nuevo.";
  if (error?.code === "reconnect_required") return integration === "contacts"
    ? "Contactos no están conectados. Vuelve a conectarlos desde Ajustes."
    : `${label} no está conectado. Vuelve a conectarlo desde Ajustes.`;
  if (error?.code === "permission_required") return `${label} necesita nuevos permisos. Vuelve a conectarlo desde Ajustes.`;
  if (error?.code === "integration_unavailable") return `${label} no está disponible temporalmente. Inténtalo de nuevo en unos instantes.`;
  return error?.message || fallback;
}

export function createGoogleIntegration({ notify, refresh, setStatus, showConnectionHealth, saveNotes, getNotes, getAuthToken, getSession, scheduleNotification, cancelNotification }) {
  let scriptPromise = null;
  let links = normalizeConnectionReport({}, false);
  let healthRequest = null;
  const contactResults = new Map();
  const calendarResults = new Map();
  const calendarInFlight = new Set();

  const signedIn = () => Boolean(getSession?.().signedIn);

  async function programAngeliNotification(note) {
    try { await scheduleNotification?.(note); return true; }
    catch (_) { notify("Calendar está programado, pero el aviso de Angeli necesita revisión en Ajustes"); return false; }
  }

  async function removeAngeliNotification(note) {
    try { await cancelNotification?.(note); return true; }
    catch (_) { notify("El aviso se retiró de Calendar, pero Angeli no pudo confirmar su retirada"); return false; }
  }

  function updateStatus() {
    const session = getSession?.() || {};
    setStatus({
      app: `${connectionStatusText("ai", links.ai, signedIn())}${signedIn() && session.email ? ` · ${session.email}` : ""}`,
      contacts: connectionStatusText("contacts", links.contacts, signedIn()),
      calendar: connectionStatusText("calendar", links.calendar, signedIn()),
      drive: connectionStatusText("drive", links.drive, signedIn())
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

  async function request(path, body, retrySession = true) {
    const headers = { "Content-Type": "application/json" };
    headers.Authorization = `Bearer ${await getAuthToken(!retrySession)}`;
    const response = await fetch(API + path, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && data.code === "session_required" && retrySession) return request(path, body, false);
      const error = new Error(data.error || `Google respondió ${response.status}`);
      Object.assign(error, { status: response.status, code: data.code || "", integration: data.integration || "" });
      throw error;
    }
    return data;
  }

  async function syncLinks({ announce = false, force = false } = {}) {
    if (healthRequest) {
      const report = await healthRequest;
      if (force) return syncLinks({ announce, force: false });
      if (announce && connectionProblems(report).length) showConnectionHealth?.(connectionProblems(report));
      return report;
    }
    if (!signedIn()) {
      links = normalizeConnectionReport({}, false);
      updateStatus();
      if (announce) showConnectionHealth?.(connectionProblems(links));
      return links;
    }
    links = normalizeConnectionReport(Object.fromEntries(INTEGRATIONS.map(key => [key, { state: "checking" }])), true);
    updateStatus();
    healthRequest = (async () => {
      try {
        links = normalizeConnectionReport(await request("/session/status", {}), true);
      } catch (error) {
        const state = ["session_required", "account_not_allowed"].includes(error.code) ? "reconnect_required" : "unavailable";
        links = normalizeConnectionReport(Object.fromEntries(INTEGRATIONS.map(key => [key, {
          state, reason: error.code || "verification_failed"
        }])), true);
      } finally {
        updateStatus();
      }
      return links;
    })();
    try {
      const report = await healthRequest;
      if (announce && connectionProblems(report).length) showConnectionHealth?.(connectionProblems(report));
      return report;
    } finally {
      healthRequest = null;
    }
  }

  const isConnected = kind => links[kind]?.state === "connected";

  function applyFailure(kind, error, fallback) {
    const state = error?.code === "reconnect_required" ? "reconnect_required"
      : error?.code === "permission_required" ? "permission_required"
      : ["session_required", "account_not_allowed"].includes(error?.code) ? "reconnect_required" : "unavailable";
    const target = error?.integration || kind;
    links = { ...links, [target]: { state, reason: error?.code || "operation_failed" } };
    if (error?.code === "session_required") links.ai = { state, reason: "session_required" };
    updateStatus();
    notify(integrationFailureMessage(target, error, fallback));
  }

  async function requireConnection(kind) {
    if (isConnected(kind)) return true;
    await syncLinks();
    return isConnected(kind);
  }

  function statusError(kind) {
    const state = links[kind]?.state;
    const error = new Error(`${LABELS[kind]} no está conectado`);
    error.code = state === "permission_required" ? "permission_required"
      : state === "unavailable" ? "integration_unavailable" : "reconnect_required";
    error.integration = kind;
    return error;
  }

  async function connectPersistent(kind) {
    if (!signedIn()) { notify("Inicia sesión en Angeli antes de conectar Google"); return false; }
    try {
      const code = await requestCode(kind);
      await request("/oauth/exchange", { integration: kind, code, redirectUri: location.origin });
      await syncLinks({ force: true });
      if (!isConnected(kind)) {
        applyFailure(kind, { code: links[kind]?.state === "permission_required" ? "permission_required" : "integration_unavailable" });
        return false;
      }
      notify(kind === "contacts" ? "Contactos conectados y comprobados" : `${kind === "calendar" ? "Calendario" : "Drive"} conectado y comprobado`);
      return true;
    } catch (error) {
      applyFailure(kind, error, `No se pudo guardar la conexión de ${LABELS[kind]}`);
      return false;
    }
  }

  const connectContacts = () => connectPersistent("contacts");
  const connectCalendar = () => connectPersistent("calendar");
  async function connectDrive() {
    await syncLinks();
    if (isConnected("drive")) notify("Drive está listo: fotos y archivos irán a sus carpetas fijas");
    else return connectPersistent("drive");
    return true;
  }
  async function ensureDrive() { return requireConnection("drive"); }

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
    if (!(await requireConnection("contacts"))) {
      applyFailure("contacts", statusError("contacts"), "No se pudieron consultar contactos");
      return;
    }
    try {
      const data = await callApi({ integration: "contacts", action: "search", query: note.contactQuery });
      const contacts = (data.results || []).map(result => ({
        name: result.person?.names?.[0]?.displayName || note.contactQuery,
        phones: (result.person?.phoneNumbers || []).map(phone => phone.value).filter(Boolean)
      }));
      contactResults.set(note.id, { contacts });
    } catch (error) {
      const message = integrationFailureMessage("contacts", error, "No se pudieron consultar contactos");
      contactResults.set(note.id, { contacts: [], error: message });
      applyFailure("contacts", error, message);
    }
    refresh();
  }

  async function calendarRequest(method, path, eventBody) {
    if (!(await requireConnection("calendar"))) {
      throw statusError("calendar");
    }
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
      await programAngeliNotification({ ...note, calendarStatus: "synced", calendarEventId: saved.id });
      notify("Evento añadido al calendario");
    } catch (error) {
      saveNotes(getNotes().map(item => item.id === note.id ? { ...item, calendarStatus: "error" } : item));
      applyFailure("calendar", error, "No se pudo añadir el evento");
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
      await programAngeliNotification({ ...note, schedule: { ...schedule, status: "scheduled", calendarEventId: saved.id } });
      notify("Aviso programado en Calendar");
    } catch (error) {
      saveNotes(getNotes().map(item => item.id === note.id ? { ...item, schedule: { ...item.schedule, status: "error", lastError: "Calendar no pudo programar el aviso" } } : item));
      applyFailure("calendar", error, "No se pudo programar el aviso");
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
      await programAngeliNotification({ ...note, schedule: { ...schedule, status: "scheduled", relatedEventId: event.id, calendarEventId: reminder.id } });
      notify("Evento y aviso añadidos a Calendar");
    } catch (error) {
      let rollbackFailed = false;
      if (event?.id) { try { await calendarRequest("DELETE", `/${encodeURIComponent(event.id)}`); } catch (_) { rollbackFailed = true; } }
      saveNotes(getNotes().map(item => item.id === note.id ? {
        ...item,
        calendarStatus: rollbackFailed ? "partial" : "error",
        ...(rollbackFailed ? { calendarEventId: event.id, calendarId: event.calendarId || "primary", calendarUrl: event.htmlLink || "" } : {}),
        schedule: { ...item.schedule, status: "error", lastError: rollbackFailed ? "El evento se creó, pero fallaron el aviso y su retirada" : "Calendar no pudo crear la operación completa" }
      } : item));
      if (rollbackFailed) notify("El evento quedó creado; revisa Calendar antes de reintentar");
      else applyFailure("calendar", error, "No se pudo crear el evento con su aviso");
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
      await removeAngeliNotification(note);
      notify("Aviso cancelado");
    } catch (error) {
      applyFailure("calendar", error, "No se pudo cancelar");
    }
  }

  async function completeScheduledReminder(note) {
    const eventId = note.schedule?.calendarEventId;
    if (!eventId) return;
    await calendarRequest("DELETE", `/${encodeURIComponent(eventId)}`);
    await removeAngeliNotification(note);
  }

  async function updateScheduledReminder(note){
    const eventId=note.schedule?.calendarEventId;if(!eventId)return true;
    try{const payload=scheduledReminderEvent(note);delete payload.id;await calendarRequest("PATCH",`/${encodeURIComponent(eventId)}`,payload);await programAngeliNotification(note);notify("Recordatorio actualizado en Calendar");return true}catch(error){applyFailure("calendar",error,"No se pudo actualizar el recordatorio en Calendar");return false}
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
      const message = integrationFailureMessage("calendar", error, "No se pudo consultar Calendar");
      calendarResults.set(note.id, { events: [], error: message });
      applyFailure("calendar", error, message);
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
    } catch (error) {
      applyFailure("calendar", error, "No se pudo completar la cancelación");
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
    } catch (error) {
      applyFailure("calendar", error, "No se pudo actualizar");
    }
  }

  async function updateListedCalendarEvent(note,eventId,changes){
    const event=calendarResults.get(note.id)?.events?.find(item=>item.id===eventId);
    if(!event)return false;
    try{
      const saved=await calendarRequest("PATCH",`/${encodeURIComponent(eventId)}`,calendarPatch(event,changes));
      const result=calendarResults.get(note.id);
      calendarResults.set(note.id,{...result,events:result.events.map(item=>item.id===eventId?calendarCandidate(saved):item)});
      saveNotes(applyCalendarUpdateToEntries(getNotes(),note,eventId,"update",saved,changes));
      notify("Evento actualizado");refresh();return true;
    }catch(error){applyFailure("calendar",error,"No se pudo actualizar el evento");return false}
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
    updateScheduledReminder,
    reconcileScheduledReminders,
    searchCalendar,
    deleteCalendarEvent,
    updateCalendarEvent,
    updateListedCalendarEvent,
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
      ...(changes.title ? { calendarTitle: changes.title } : {}),
      ...(changes.location !== undefined ? { location: changes.location } : {}),
      ...(changes.notes !== undefined ? { calendarDescription: changes.notes } : {}),
      ...((changes.title||changes.notes!==undefined)?{aiIntent:{...item.aiIntent,...(changes.title?{title:changes.title}:{}),...(changes.notes!==undefined?{notes:changes.notes||null}:{})}}:{}),
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
    allDay: !event.start?.dateTime,
    location: event.location || "",
    description: event.description || "",
    htmlLink: event.htmlLink || ""
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
  if (changes.location !== undefined) result.location = changes.location;
  if (changes.notes !== undefined) result.description = changes.notes;
  if (changes.date || changes.time) {
    if(event.allDay){const start=changes.date||event.start.slice(0,10),finish=new Date(`${start}T12:00:00`);finish.setDate(finish.getDate()+1);result.start={date:start};result.end={date:finish.toISOString().slice(0,10)};return result}
    const date = changes.date || event.start.slice(0, 10);
    const time = changes.time || event.start.slice(11, 16);
    result.start = { dateTime: calendarDateTime(date, time), timeZone: "Europe/Madrid" };
    result.end = { dateTime: calendarEnd(date, time), timeZone: "Europe/Madrid" };
  }
  return result;
}
