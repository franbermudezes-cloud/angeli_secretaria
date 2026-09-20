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
  assert.match(firebase, /async function saveShortcuts\(items, hidden = false\)/);
  assert.match(firebase, /onSnapshot\(shortcutsDocument\(\)/);
  assert.match(firebase, /saveNoteSettings,\s*saveNotificationSettings,\s*saveShoppingState,\s*saveShortcuts/, "saveShortcuts debe exportarse igual que el resto de ajustes sincronizados");
  const saveShortcutsSource = app.match(/function saveShortcuts\(\)\{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(saveShortcutsSource, "saveShortcuts debe existir en app.js");
  assert.match(saveShortcutsSource, /cloud\.saveShortcuts\(shortcuts,shortcutsHidden\)/, "cada guardado local debe subirse también a la nube, junto con si está oculta la fila");
  assert.match(app, /onShortcuts:remote=>\{if\(remote&&Array\.isArray\(remote\.items\)\)/, "si la nube ya tiene accesos guardados, deben ganar sobre los locales de este dispositivo");
  assert.match(app, /else void cloud\.saveShortcuts\(shortcuts,shortcutsHidden\)\.catch/, "si la nube está vacía, se sube lo que ya hubiera en este dispositivo en vez de perderlo");
});

// Pedido explícito del propietario: poder dejar la pantalla principal
// limpia del todo — "ni accesos directos ni el más ni nada" — no solo
// borrar accesos uno a uno desde el modal de gestión.
test("accesos directos: se pueden ocultar del todo (fila + botón ＋) desde Ajustes, sincronizado entre dispositivos", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../js/storage.js", import.meta.url), "utf8");
  assert.match(html, /id="shortcutsSection"/);
  assert.match(html, /id="shortcutsToggleHide"/);
  assert.match(app, /\$\("shortcutsToggleHide"\)\.onclick=toggleShortcutsHidden/);
  assert.match(app, /function toggleShortcutsHidden\(\)/);
  const renderSource = app.match(/function renderShortcuts\(\)\{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(renderSource, "renderShortcuts debe existir");
  assert.match(renderSource, /\$\("shortcutsSection"\)\.hidden=shortcutsHidden/, "debe ocultar toda la sección, no solo vaciar la lista (si no, el ＋ seguiría viéndose)");
  assert.match(storage, /export function readShortcutsHidden\(\)/);
  assert.match(storage, /export function writeShortcutsHidden\(hidden\)/);
});

// Pedido explícito: "como había antes, que pudiera elegir ya accesos
// directos con su icono y todo ya puesto" — un catálogo de accesos ya
// preparados en vez de escribir el texto y buscar un icono a mano cada vez.
test("elegir un acceso directo de una lista ya preparada, sin tener que escribirlo a mano", () => {
  const shortcuts = readFileSync(new URL("../js/shortcuts.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(shortcuts, /export const SHORTCUT_PRESETS = \[/);
  assert.match(shortcuts, /\.\.\.DEFAULT_SHORTCUTS,/, "debe incluir los accesos por defecto, por si se borró alguno y se quiere recuperar");
  assert.match(app, /function pickShortcutPreset\(\)/);
  const pickSource = app.match(/function pickShortcutPreset\(\)\{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(pickSource, "pickShortcutPreset debe existir");
  assert.match(pickSource, /shortcuts\.push\(\{\.\.\.preset\}\)/, "tocar uno lo añade tal cual, sin pedir texto ni icono");
  assert.match(pickSource, /createShortcut\(\)/, "debe seguir ofreciendo crear uno personalizado como alternativa");
  assert.match(app, /\$\("shortcutManual"\)\.onclick=\(\)=>\{ui\.closeLayers\(\);pickShortcutPreset\(\)\}/);
  assert.match(app, /if\(button\.id==="shortcutAdd"\)\{pickShortcutPreset\(\);return\}/, 'el "＋" de la propia fila también debe abrir el catálogo, no el viejo prompt()');
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

// Pedido explícito del propietario: poder quitar de verdad un acceso
// directo desde Ajustes, no solo dejarlo fuera de la vista. Sustituye al
// viejo flujo con prompt() por un modal real (mismo patrón que el resto de
// "quitar algo de una lista" de esta app).
test("accesos directos: se pueden quitar de verdad desde un modal en Ajustes, no con prompt()", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(app, /function manageShortcuts\(\)/);
  const manageSource = app.match(/function manageShortcuts\(\)\{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(manageSource, "manageShortcuts debe existir");
  assert.match(manageSource, /shortcuts\.splice\(index,1\)/);
  assert.match(manageSource, /saveShortcuts\(\)/);
  assert.doesNotMatch(manageSource, /\bprompt\(/, "ya no debe depender de prompt() para elegir qué borrar");
  assert.match(app, /\$\("shortcutEdit"\)\.onclick=\(\)=>\{ui\.closeLayers\(\);manageShortcuts\(\)\}/, 'debe cerrar el menú de Ajustes antes de abrir el modal, igual que "Ajustes de notas" — si no, el modal queda tapado detrás del propio menú (settings-menu, z-index más alto)');
  assert.match(html, /id="shortcutEdit"/);
});

// Pedido explícito: los mismos accesos rápidos que ya existen para
// Notas/Recordatorios/Calendario, ahora también para Llamar contacto y
// WhatsApp — reutilizando los mismos objetos de DEFAULT_SHORTCUTS ya usados
// en la fila de accesos directos, sin duplicar su definición.
test("accesos rápidos nuevos para llamar y WhatsApp reutilizan los mismos DEFAULT_SHORTCUTS de siempre", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="quickCallBtn"/);
  assert.match(html, /id="quickWhatsappBtn"/);
  assert.match(app, /\$\("quickCallBtn"\)\.onclick=\(\)=>prepareShortcut\(DEFAULT_SHORTCUTS\[2\]\)/);
  assert.match(app, /\$\("quickWhatsappBtn"\)\.onclick=\(\)=>prepareShortcut\(DEFAULT_SHORTCUTS\[3\]\)/);
  assert.equal(DEFAULT_SHORTCUTS[2].action, "contact.call");
  assert.equal(DEFAULT_SHORTCUTS[3].action, "whatsapp.compose");
});
