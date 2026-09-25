/**
 * Cuenta Angeli y fuente única de entradas.
 *
 * Firestore es el registro compartido. El navegador solo conserva la caché
 * offline administrada por Firebase; Angeli no mezcla ni migra notas desde
 * localStorage.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
  waitForPendingWrites
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js";
import { fromCloudEntry, sameEntry, toCloudEntry } from "./cloud-entry.js?v=0.25.4";
import { normalizeNotificationSettings } from "./notification-settings.js?v=0.25.4";
import { applyShortcutsDiff, diffShortcuts } from "./shortcuts.js?v=0.25.4";

const API = "https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app";
const VAPID_KEY = "BHyc8Ne9wyaAFoju-9FNG5_qCXPOLSQhHhsfye9bdFlAv3zdLfAvjcvb29Cyrtj80kSq7gJ3qGJ9k3Mb_EqYt_o";

const firebaseConfig = {
  apiKey: "AIzaSyAFM5NjcxX9lC5MpfII4B3Kx7lV9SsUAsc",
  authDomain: "angeli-secretaria.firebaseapp.com",
  projectId: "angeli-secretaria",
  storageBucket: "angeli-secretaria.firebasestorage.app",
  messagingSenderId: "172772694205",
  appId: "1:172772694205:web:6ce976de4a3658c12f3fd4"
};
// Esta es la cuenta propietaria de Angeli. Contactos y Calendar pueden seguir
// vinculándose con cuentas distintas desde sus botones específicos.
const OWNER_EMAIL = "franbermudez.es@gmail.com";
// La base creada en Firebase tiene nombre propio. Sin este ID el SDK usa
// `(default)`, que es otra base distinta y no comparte las entradas de Angeli.
const FIRESTORE_DATABASE_ID = "angelifirebase";

export function createCloudSync({ notify }) {
  let auth;
  let db;
  let user = null;
  let access = null;
  let unsubscribe = null;
  let unsubscribeSettings = null;
  let unsubscribeNotificationSettings = null;
  let unsubscribeShoppingList = null;
  let unsubscribeShortcuts = null;
  let callbacks = {};
  let messaging = null;
  let currentPushToken = "";
  let pushRegistrationPending = false;
  let foregroundListenerReady = false;

  async function initialize(handlers) {
    callbacks = handlers || {};
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app, FIRESTORE_DATABASE_ID);
    await setPersistence(auth, browserLocalPersistence);
    try { await getRedirectResult(auth); } catch (error) {
      notify("No se pudo completar el inicio de sesión");
    }
    onAuthStateChanged(auth, async nextUser => {
      // Un nextUser nulo (cerrar sesión, o cargar sin sesión previa) cae siempre
      // al flujo de "desconectado": limpia `user`, para los listeners de
      // Firestore y avisa a la UI. Tratarlo antes evita el fallo histórico en
      // que una condición "email !== OWNER" también era cierta para un usuario
      // nulo y dejaba la app pegada como si siguiera conectada.
      if (!nextUser) {
        user = null;
        access = null;
        stopListening();
        callbacks.onAuthChange?.(session());
        callbacks.onSyncStatus?.({ state: "signed-out" });
        callbacks.onPushStatus?.(pushStatus());
        return;
      }
      // El propietario entra directo, sin preguntar al servidor. Cualquier otra
      // cuenta debe estar invitada: el servidor (autoridad real del acceso)
      // responde si está dada de alta y con cuánto cupo; si no, se cierra la
      // sesión con un mensaje claro en lugar de dejarla a medias.
      const email = nextUser.email?.toLowerCase() || "";
      let decision;
      if (email === OWNER_EMAIL) {
        decision = { allowed: true, owner: true, mode: "owner", limit: null, used: 0, remaining: null };
      } else {
        try {
          decision = await fetchAccessStatus(nextUser);
        } catch (error) {
          // 3ª auditoría: cualquier fallo de red (abrir la app sin conexión, un
          // arranque lento del servidor, un 503) cerraba la sesión del invitado,
          // que tenía que volver a entrar. Solo un «no» explícito del servidor
          // cierra la sesión; si no se pudo comprobar, se sigue con acceso
          // «desconocido»: los datos los protegen las reglas de Firestore y la
          // IA la vuelve a comprobar el servidor en cada petición.
          notify("No se pudo comprobar tu acceso ahora; tu sesión sigue abierta y se volverá a comprobar");
          decision = { allowed: true, owner: false, mode: "unknown", limit: null, used: 0, remaining: null };
        }
        if (!decision?.allowed) {
          notify(decision?.reason === "blocked"
            ? "Tu acceso a Angeli está en pausa. Pídele que lo reactive a quien te dio de alta."
            : "Aún no tienes acceso a Angeli. Pídele el alta con este correo a quien te lo recomendó.");
          await signOut(auth);
          return;
        }
      }
      user = nextUser;
      access = decision;
      stopListening();
      callbacks.onAuthChange?.(session());
      subscribe();
      subscribeSettings();
      if (Notification.permission === "granted" && localStorage.getItem("angeliPushDisabled") !== "1") void enablePush(false).catch(() => callbacks.onPushStatus?.(pushStatus()));
    });
  }

  function session() {
    return {
      signedIn: Boolean(user),
      email: user?.email || "",
      uid: user?.uid || "",
      owner: Boolean(access?.owner),
      mode: access?.mode || "",
      limit: access?.limit ?? null,
      used: access?.used ?? 0,
      remaining: access?.remaining ?? null
    };
  }

  // El servidor es la autoridad del acceso: responde si esta cuenta está
  // invitada y con cuánto cupo, incluso a una cuenta identificada pero aún no
  // dada de alta (para poder mostrarle "pide el alta" en vez de un error).
  async function fetchAccessStatus(account) {
    const token = await account.getIdToken();
    const response = await fetch(API + "/access/status", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}"
    });
    if (!response.ok) throw new Error("No se pudo comprobar el acceso");
    return response.json();
  }

  // Administración de invitaciones: solo el propietario puede leer o escribir la
  // colección `access` (lo impone firestore.rules). El panel las gestiona aquí.
  function accessCollection() {
    if (!db) throw new Error("Sesión de Angeli no disponible");
    return collection(db, "access");
  }

  function watchAccessList(onList, onError) {
    return onSnapshot(accessCollection(), snapshot => {
      onList(snapshot.docs.map(entry => ({ email: entry.id, ...entry.data() })));
    }, onError);
  }

  async function saveAccessEntry(email, data) {
    const key = String(email || "").trim().toLowerCase();
    if (!key) throw new Error("Correo no válido");
    await setDoc(doc(db, "access", key), { email: key, ...data }, { merge: true });
  }

  async function removeAccessEntry(email) {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return;
    await deleteDoc(doc(db, "access", key));
  }

  function isSignedIn() { return Boolean(user); }

  async function getAuthToken(forceRefresh = false) {
    if (!user) throw new Error("Inicia sesión en Angeli primero");
    return user.getIdToken(forceRefresh);
  }

  async function connect() {
    if (user) return true;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
      return true;
    } catch (error) {
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
        await signInWithRedirect(auth, provider);
        return false;
      }
      notify("No se pudo iniciar sesión en Angeli");
      return false;
    }
  }

  async function disconnect() {
    if (auth) await signOut(auth);
  }

  function pushStatus() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return { state: "unsupported", text: "Este navegador no admite avisos" };
    if (!user) return { state: "signed-out", text: "Inicia sesión en Angeli primero" };
    if (Notification.permission === "denied") return { state: "blocked", text: "Avisos bloqueados en el navegador" };
    if (Notification.permission === "granted" && currentPushToken) return { state: "enabled", text: "Avisos activos en este dispositivo" };
    if (Notification.permission === "granted" && pushRegistrationPending) return { state: "connecting", text: "Preparando avisos en este dispositivo…" };
    if (Notification.permission === "granted") return { state: "available", text: "Avisos desactivados en este dispositivo" };
    return { state: "available", text: "Activa los avisos en este dispositivo" };
  }

  async function pushRequest(path, body = {}) {
    const token = await getAuthToken();
    const response = await fetch(API + path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "No se pudo configurar el aviso");
    return result;
  }

  async function enablePush(askPermission = true) {
    if (!user) throw new Error("Inicia sesión en Angeli primero");
    if (!await isSupported()) throw new Error("Este navegador no admite avisos");
    if (askPermission && Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") { callbacks.onPushStatus?.(pushStatus()); throw new Error("Los avisos no están permitidos"); }
    pushRegistrationPending = true;
    callbacks.onPushStatus?.(pushStatus());
    try {
      const registration = await navigator.serviceWorker.ready;
      messaging ||= getMessaging(auth.app);
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
      if (!token) throw new Error("No se pudo identificar este dispositivo");
      await pushRequest("/push/register", { token, label: `${navigator.platform || "Dispositivo"} · ${navigator.userAgent.includes("Mobile") ? "móvil" : "ordenador"}` });
      currentPushToken = token;
      localStorage.removeItem("angeliPushDisabled");
      if (!foregroundListenerReady) {
        onMessage(messaging, payload => {
          const title=payload.data?.title||"Angeli",body=payload.data?.body||"Tienes un recordatorio.";
          if(!payload.data?.entryId) notify(`${title}: ${body}`);
          const options={body,icon:"icon-192.png",badge:"icon-192.png",data:{url:payload.data?.url||"./"},tag:payload.data?.entryId||"angeli-test"};
          try{
            // Chrome en macOS puede recibir el mensaje en primer plano sin
            // presentar showNotification del service worker. La notificación
            // de ventana usa el canal nativo que macOS asigna a ese perfil.
            if(!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)){
              const notification=new Notification(title,options);
              notification.onclick=()=>{window.focus();notification.close()};
              return;
            }
          }catch(_){/* continuar con el canal del service worker */}
          void registration.showNotification(title,options).catch(()=>notify(`${title}: ${body}`));
        });
        foregroundListenerReady = true;
      }
      return true;
    } finally {
      pushRegistrationPending = false;
      callbacks.onPushStatus?.(pushStatus());
    }
  }

  async function disablePush() {
    if (currentPushToken) await pushRequest("/push/unregister", { token: currentPushToken });
    if (messaging) await deleteToken(messaging).catch(() => false);
    currentPushToken = "";
    localStorage.setItem("angeliPushDisabled", "1");
    callbacks.onPushStatus?.(pushStatus());
    return true;
  }

  async function schedulePush(entry) {
    const dueAt=entry.schedule?.dueAt||(entry.scheduledDate&&entry.scheduledTime?`${entry.scheduledDate}T${entry.scheduledTime}:00`:null);
    if(!dueAt) return {scheduled:false,reason:"missing_date"};
    return pushRequest("/push/schedule", { entryId: entry.id, dueAt });
  }
  async function cancelPush(entry) { return pushRequest("/push/cancel", { entryId: entry.id }); }
  async function testPush() {
    if (!currentPushToken) await enablePush(false);
    if (!currentPushToken) throw new Error("Este dispositivo todavía no está preparado");
    return pushRequest("/push/test", { token: currentPushToken });
  }

  function subscribe() {
    callbacks.onSyncStatus?.({ state: "connecting" });
    unsubscribe = onSnapshot(entriesCollection(), { includeMetadataChanges: true }, snapshot => {
      const remoteNotes = snapshot.docs.map(item => fromCloudEntry(item.data(), item.id)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      callbacks.onRemoteNotes?.(remoteNotes, { fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites });
      callbacks.onSyncStatus?.({ state: snapshot.metadata.hasPendingWrites ? "pending" : snapshot.metadata.fromCache ? "offline" : "synced" });
    }, error => callbacks.onSyncStatus?.({ state: "error", error }));
  }

  async function syncNotes(nextNotes, previousNotes) {
    if (!user || !db) throw new Error("Inicia sesión en Angeli para guardar");
    const before = new Map((previousNotes || []).filter(note => note?.id).map(note => [note.id, note]));
    const after = new Map((nextNotes || []).filter(note => note?.id).map(note => [note.id, note]));
    const operations = [];
    for (const [id, note] of after) {
      if (!sameEntry(note, before.get(id))) operations.push(setDoc(doc(entriesCollection(), id), toCloudEntry(note)));
    }
    for (const id of before.keys()) if (!after.has(id)) operations.push(deleteDoc(doc(entriesCollection(), id)));
    if (operations.length) callbacks.onSyncStatus?.({ state: "pending" });
    if (!operations.length) return true;
    await Promise.all(operations);
    // setDoc confirma primero la cola local. Esperar aquí garantiza que el
    // estado "sincronizado" solo llegue tras la confirmación del servidor.
    await waitForPendingWrites(db);
    return true;
  }

  async function saveNoteSettings(settings) {
    if (!user || !db) throw new Error("Inicia sesión en Angeli para guardar ajustes");
    await setDoc(noteSettingsDocument(), settings);
    await waitForPendingWrites(db);
    return true;
  }

  async function saveNotificationSettings(settings) {
    if (!user || !db) throw new Error("Inicia sesión en Angeli para guardar ajustes");
    await setDoc(notificationSettingsDocument(), normalizeNotificationSettings(settings));
    await waitForPendingWrites(db);
    return true;
  }

  function subscribeSettings() {
    unsubscribeSettings?.();
    unsubscribeSettings = onSnapshot(noteSettingsDocument(), snapshot => callbacks.onNoteSettings?.(snapshot.exists() ? snapshot.data() : null), error => callbacks.onNoteSettingsError?.(error));
    unsubscribeNotificationSettings?.();
    unsubscribeNotificationSettings = onSnapshot(notificationSettingsDocument(), snapshot => callbacks.onNotificationSettings?.(normalizeNotificationSettings(snapshot.exists() ? snapshot.data() : {})), error => callbacks.onNotificationSettingsError?.(error));
    unsubscribeShoppingList?.();
    // Se pasa el documento tal cual (sin normalizar aquí): puede venir en el
    // formato antiguo (una sola lista sin nombre) o en el nuevo (varias
    // listas con nombre) — normalizeShoppingState (js/shopping.js) decide
    // cómo migrarlo, no este módulo de sincronización.
    unsubscribeShoppingList = onSnapshot(shoppingListDocument(), snapshot => callbacks.onShoppingState?.(snapshot.exists() ? snapshot.data() : null), error => callbacks.onShoppingListError?.(error));
    unsubscribeShortcuts?.();
    // Igual que la lista de la compra: se pasa el documento entero tal cual
    // viene ({items, hidden}), o null si nunca se ha guardado nada todavía,
    // sin normalizar aquí — normalizeShortcuts (js/shortcuts.js) decide qué
    // hacer con eso, incluida la migración inicial descrita en app.js.
    unsubscribeShortcuts = onSnapshot(shortcutsDocument(), snapshot => callbacks.onShortcuts?.(snapshot.exists() ? snapshot.data() : null), error => callbacks.onShortcutsError?.(error));
  }

  async function saveShoppingState(state) {
    if (!user || !db) throw new Error("Inicia sesión en Angeli para guardar la lista de la compra");
    await setDoc(shoppingListDocument(), state);
    await waitForPendingWrites(db);
    return true;
  }

  // Real reportado: dos móviles editando los accesos directos casi a la vez
  // (uno crea uno, el otro borra otro) — antes esto era un setDoc() que
  // sobrescribía {items,hidden} entero, así que el segundo guardado pisaba
  // sin avisar el cambio del primero. Ahora se recibe también `previous`
  // (los accesos tal y como estaban en ESTE dispositivo antes de la
  // edición local) para calcular qué cambió aquí, y una transacción lee la
  // copia más reciente de la nube y le aplica solo esos cambios — así el
  // acceso que haya añadido o borrado el otro móvil mientras tanto no se
  // pierde. Devuelve el resultado ya fusionado para que app.js actualice su
  // copia local con lo que de verdad quedó guardado (puede incluir cambios
  // del otro dispositivo que este todavía no tenía).
  async function saveShortcuts(previous, items, hidden = false) {
    if (!user || !db) throw new Error("Inicia sesión en Angeli para guardar los accesos directos");
    const diff = diffShortcuts(previous, items);
    const ref = shortcutsDocument();
    const merged = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      const remoteItems = snapshot.exists() && Array.isArray(snapshot.data().items) ? snapshot.data().items : [];
      const mergedItems = applyShortcutsDiff(remoteItems, diff);
      transaction.set(ref, { items: mergedItems, hidden });
      return mergedItems;
    });
    await waitForPendingWrites(db);
    return merged;
  }

  function stopListening() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (unsubscribeSettings) unsubscribeSettings();
    unsubscribeSettings = null;
    if (unsubscribeNotificationSettings) unsubscribeNotificationSettings();
    unsubscribeNotificationSettings = null;
    if (unsubscribeShoppingList) unsubscribeShoppingList();
    unsubscribeShoppingList = null;
    if (unsubscribeShortcuts) unsubscribeShortcuts();
    unsubscribeShortcuts = null;
  }

  function entriesCollection() {
    if (!user || !db) throw new Error("Sesión de Angeli no disponible");
    return collection(db, "users", user.uid, "entries");
  }

  function noteSettingsDocument() {
    if (!user || !db) throw new Error("Sesión de Angeli no disponible");
    return doc(db, "users", user.uid, "settings", "notes");
  }

  function notificationSettingsDocument() {
    if (!user || !db) throw new Error("Sesión de Angeli no disponible");
    return doc(db, "users", user.uid, "settings", "notifications");
  }

  function shoppingListDocument() {
    if (!user || !db) throw new Error("Sesión de Angeli no disponible");
    // Reaprovecha la colección "settings", ya autorizada en firestore.rules
    // (solo "entries" y "settings" están permitidas bajo users/{uid}). Un
    // documento nuevo bajo "lists" quedaba fuera de esas reglas: se escribía
    // y se leía en local sin avisar de forma clara, pero Firestore lo
    // rechazaba en el servidor — por eso no llegaba a sincronizar entre
    // dispositivos aunque pareciera guardado en el que lo creó.
    return doc(db, "users", user.uid, "settings", "shopping");
  }

  function shortcutsDocument() {
    if (!user || !db) throw new Error("Sesión de Angeli no disponible");
    return doc(db, "users", user.uid, "settings", "shortcuts");
  }

  return { initialize, session, isSignedIn, getAuthToken, connect, disconnect, syncNotes, saveNoteSettings, saveNotificationSettings, saveShoppingState, saveShortcuts, pushStatus, enablePush, disablePush, schedulePush, cancelPush, testPush, watchAccessList, saveAccessEntry, removeAccessEntry };
}
