/**
 * Sesión de Angeli y sincronización de entradas.
 *
 * Firebase Auth identifica a la persona propietaria de la aplicación. Cloud
 * Firestore es la fuente compartida de las entradas entre sus dispositivos;
 * localStorage se conserva como copia local y vía de migración segura.
 *
 * Los blobs de imágenes y archivos siguen en IndexedDB hasta el bloque propio
 * de almacenamiento remoto. Nunca se eliminan durante esta migración.
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
  enableIndexedDbPersistence,
  getDocs,
  getFirestore,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

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

const SYNCABLE_FIELDS = new Set([
  "id", "date", "updatedAt", "text", "status", "type", "scheduledDate",
  "scheduledTime", "phone", "location", "calendarTitle", "contactQuery",
  "calendarStatus", "calendarEventId", "calendarUrl", "aiIntent", "proposal",
  "schedule", "images", "files"
]);

export function createCloudSync({ notify }) {
  let auth;
  let db;
  let user = null;
  let unsubscribe = null;
  let callbacks = {};
  let bootstrapping = false;

  async function initialize(handlers) {
    callbacks = handlers || {};
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    try { await enableIndexedDbPersistence(db); } catch (_) {
      // Otra pestaña puede estar usando Firestore; la sincronización online sigue funcionando.
    }
    await setPersistence(auth, browserLocalPersistence);
    try { await getRedirectResult(auth); } catch (error) {
      notify("No se pudo completar el inicio de sesión");
    }
    onAuthStateChanged(auth, async nextUser => {
      if (nextUser?.email?.toLowerCase() !== OWNER_EMAIL) {
        if (nextUser) {
          notify("Esta no es la cuenta principal de Angeli");
          await signOut(auth);
        }
        return;
      }
      user = nextUser || null;
      stopListening();
      callbacks.onAuthChange?.(session());
      if (!user) return;
      try {
        await subscribeAndMigrate();
      } catch (_) {
        notify("Sesión iniciada, pero aún no se pudo abrir la sincronización");
      }
    });
  }

  function session() {
    return {
      signedIn: Boolean(user),
      email: user?.email || "",
      uid: user?.uid || ""
    };
  }

  function isSignedIn() { return Boolean(user); }

  async function getAuthToken() {
    if (!user) throw new Error("Inicia sesión en Angeli primero");
    return user.getIdToken();
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

  async function subscribeAndMigrate() {
    const entries = entriesCollection();
    bootstrapping = true;
    const localAtStart = callbacks.getLocalNotes?.() || [];
    const remote = await getDocs(entries);
    const remoteIds = new Set(remote.docs.map(item => item.id));
    const missing = localAtStart.filter(note => note?.id && !remoteIds.has(note.id));
    if (missing.length) {
      await Promise.all(missing.map(note => setDoc(doc(entries, note.id), toCloudEntry(note), { merge: false })));
    }
    unsubscribe = onSnapshot(entries, snapshot => {
      const remoteNotes = snapshot.docs.map(item => fromCloudEntry(item.data(), item.id)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      callbacks.onRemoteNotes?.(remoteNotes, { bootstrapping });
      bootstrapping = false;
    }, () => notify("No se pudo sincronizar Angeli ahora mismo"));
  }

  async function syncNotes(nextNotes, previousNotes) {
    if (!user || !db) return false;
    const before = new Map((previousNotes || []).filter(note => note?.id).map(note => [note.id, note]));
    const after = new Map((nextNotes || []).filter(note => note?.id).map(note => [note.id, note]));
    const operations = [];
    for (const [id, note] of after) {
      if (!sameEntry(note, before.get(id))) operations.push(setDoc(doc(entriesCollection(), id), toCloudEntry(note), { merge: false }));
    }
    for (const id of before.keys()) if (!after.has(id)) operations.push(deleteDoc(doc(entriesCollection(), id)));
    if (!operations.length) return true;
    await Promise.all(operations);
    return true;
  }

  function stopListening() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  }

  function entriesCollection() {
    if (!user || !db) throw new Error("Sesión de Angeli no disponible");
    return collection(db, "users", user.uid, "entries");
  }

  return { initialize, session, isSignedIn, getAuthToken, connect, disconnect, syncNotes };
}

function toCloudEntry(note) {
  const result = {};
  for (const [key, value] of Object.entries(note || {})) {
    if (SYNCABLE_FIELDS.has(key) && value !== undefined) result[key] = removeUndefined(value);
  }
  result.updatedAt = new Date().toISOString();
  return result;
}

function fromCloudEntry(value, id) {
  return { ...removeUndefined(value || {}), id };
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, removeUndefined(item)]));
  return value;
}

function sameEntry(left, right) {
  return JSON.stringify(removeUndefined(left || {})) === JSON.stringify(removeUndefined(right || {}));
}
