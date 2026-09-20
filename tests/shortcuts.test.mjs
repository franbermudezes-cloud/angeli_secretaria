import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_SHORTCUTS, normalizeShortcuts, routeShortcutIntent, shortcutPrefix, shortcutSemantics, shortcutType } from "../js/shortcuts.js";

test("una petición normal sin acceso directo no intenta leer action de null", () => {
  assert.equal(shortcutType(null), null);
  assert.equal(shortcutPrefix(null), "");
  assert.deepEqual(shortcutSemantics(null), { action: null, direct: false });
});

test("accesos directos: los accesos base conservan una intención explícita", () => {
  assert.deepEqual(DEFAULT_SHORTCUTS.map(item => item.action), [
    "calendar.query", "calendar.query", "contact.call", "whatsapp.compose", "calendar.create", "reminder.create", "calendar.delete"
  ]);
  assert.equal(shortcutPrefix(DEFAULT_SHORTCUTS[5]), "Recuérdame ");
  assert.equal(shortcutPrefix(DEFAULT_SHORTCUTS[4]), "Añade al calendario ");
  assert.equal(shortcutPrefix(DEFAULT_SHORTCUTS[6]), "Cancela ");
});

test("accesos directos: los accesos antiguos guardados se enriquecen sin recrearlos", () => {
  const legacy = [
    { label: "📞 Llamar contacto", prefix: "Llama a " },
    { label: "⏰ Recordatorio" },
    { label: "Mis citas", command: "¿Qué tengo esta semana?" }
  ];
  assert.deepEqual(normalizeShortcuts(legacy).map(item => [item.action, item.direct]), [
    ["contact.call", true], ["reminder.create", false], ["calendar.query", true]
  ]);
  assert.equal(shortcutSemantics({ label: "Aviso", command: "Recuérdame llamar a Miguel" }).action, "reminder.create");
});

test("accesos directos: la intención elegida vence una clasificación errónea como nota", () => {
  const wrong = { intent: "note", confidence: .9, title: "Monse", date: null, time: null, contactName: null, requiresConfirmation: false };
  const now = new Date(2026, 7, 31, 12);
  const reminder = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[5], "Recuérdame comprar ruedas mañana a las diez de la mañana", now);
  assert.equal(reminder.intent, "reminder.create");
  assert.equal(reminder.date, "2026-09-01");
  assert.equal(reminder.time, "10:00");
  const call = routeShortcutIntent({ ...wrong, date: "2026-09-01", time: "10:00" }, DEFAULT_SHORTCUTS[2], "Llama a Monse", now);
  assert.equal(call.intent, "contact.call");
  assert.equal(call.date, null);
  assert.equal(call.time, null);
  assert.equal(call.contactName, "Monse");
  const event = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[4], "Añade al calendario cena con María mañana a las nueve de la noche", now);
  assert.equal(event.intent, "calendar.create");
  assert.equal(event.title, "cena con María mañana a las nueve de la noche");
  const query = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[0], "¿Qué tengo hoy?", now);
  assert.equal(query.intent, "calendar.query");
  assert.ok(query.rangeStart && query.rangeEnd);
  const cancellation = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[6], "Cancela cena con María", now);
  assert.equal(cancellation.intent, "calendar.delete");
  assert.equal(cancellation.target.title, "cena con María");
});

test("accesos directos: consultas y llamadas ejecutan la búsqueda sin tarjeta intermedia", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(app, /shortcutContext\?\.direct&&interpretation\.intent==="calendar\.query"/);
  assert.match(app, /shortcutContext\?\.direct&&interpretation\.intent==="contact\.call"[\s\S]*google\.searchContact\(entry\)/);
  assert.match(worker, /\.\/js\/shortcuts\.js\?v=/);
});

// Regresión real reportada por el propietario: el móvil tenía 7 accesos
// directos y el ordenador (PWA) solo 3 — cada dispositivo los guardaba
// únicamente en su propio localStorage, sin sincronizar nunca entre sí
// (a diferencia de la lista de la compra o los ajustes de notas, que sí
// viven en Firestore). Ahora cada cambio se sube también a
// users/{uid}/settings/shortcuts, con la misma migración transparente que
// ya usa la lista de la compra: si la nube no tiene nada guardado todavía,
// se sube lo que ya hubiera en este dispositivo en vez de perderlo.
test("accesos directos: se sincronizan con Firestore igual que la lista de la compra", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const firebase = readFileSync(new URL("../js/firebase.js", import.meta.url), "utf8");
  assert.match(firebase, /function shortcutsDocument\(\)/);
  assert.match(firebase, /"settings",\s*"shortcuts"/);
  assert.match(firebase, /async function saveShortcuts\(items\)/);
  assert.match(firebase, /onSnapshot\(shortcutsDocument\(\)/);
  assert.match(firebase, /saveNoteSettings,\s*saveNotificationSettings,\s*saveShoppingState,\s*saveShortcuts/, "saveShortcuts debe exportarse igual que el resto de ajustes sincronizados");
  const saveShortcutsSource = app.match(/function saveShortcuts\(\)\{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(saveShortcutsSource, "saveShortcuts debe existir en app.js");
  assert.match(saveShortcutsSource, /cloud\.saveShortcuts\(shortcuts\)/, "cada guardado local debe subirse también a la nube");
  assert.match(app, /onShortcuts:remote=>\{if\(Array\.isArray\(remote\)\)/, "si la nube ya tiene accesos guardados, deben ganar sobre los locales de este dispositivo");
  assert.match(app, /else void cloud\.saveShortcuts\(shortcuts\)\.catch/, "si la nube está vacía, se sube lo que ya hubiera en este dispositivo en vez de perderlo");
});

// Regresión real reportada por el propietario: con más accesos precargados,
// la fila con scroll horizontal escondía la mayoría fuera de la pantalla y
// obligaba a desplazarse para verlos todos. Ahora la fila envuelve en varias
// líneas para que todos queden visibles sin desplazamiento.
test("accesos directos: la fila envuelve en vez de desplazarse horizontalmente", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const shortcutsCss = css.match(/\.shortcuts\{[^}]*\}/)?.[0] || "";
  assert.ok(shortcutsCss, "debe existir la regla .shortcuts");
  assert.match(shortcutsCss, /flex-wrap:wrap/);
  assert.doesNotMatch(shortcutsCss, /overflow-x:auto/);
});
