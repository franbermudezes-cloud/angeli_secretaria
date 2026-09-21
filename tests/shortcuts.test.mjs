import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_SHORTCUTS, applyShortcutsDiff, diffShortcuts, normalizeShortcuts, routeShortcutIntent, shortcutPrefix, shortcutSemantics, shortcutType } from "../js/shortcuts.js";

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
  assert.match(worker, /\.\/js\/shortcuts\.js\?v=/);
});

// Pedido explícito del propietario: "no tengo el por qué de hacer yo clic
// para que haga la búsqueda" — antes solo se buscaba el contacto sola
// cuando la orden venía del acceso directo "Llamar contacto"
// (shortcutContext?.direct); hablar o escribir la orden normal, o cualquier
// WhatsApp, obligaba a tocar "Buscar contacto" a mano. Ahora se busca sola
// en cuanto se conoce a quién, sin depender de cómo llegó la orden.
test("contact.call y whatsapp.compose buscan el contacto solos, sin esperar a un clic ni a venir de un acceso directo", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /shortcutContext\?\.direct&&interpretation\.intent==="contact\.call"/, "ya no debe depender de que la orden viniera de un acceso directo");
  assert.match(app, /if\(\(interpretation\.intent==="contact\.call"\|\|interpretation\.intent==="whatsapp\.compose"\)&&!entry\.phone\)\{/);
  const autoSearchSource = app.match(/if\(\(interpretation\.intent==="contact\.call"\|\|interpretation\.intent==="whatsapp\.compose"\)&&!entry\.phone\)\{[\s\S]*?\n     \}/)?.[0] || "";
  assert.ok(autoSearchSource, "la búsqueda automática de contacto debe existir");
  assert.match(autoSearchSource, /google\.searchContact\(entry\)/);
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
  assert.match(firebase, /async function saveShortcuts\(previous, items, hidden = false\)/, "debe recibir también la copia previa local para poder calcular qué cambió de verdad y fusionarlo por id, en vez de sobrescribir el documento entero");
  assert.match(firebase, /runTransaction\(db, async transaction =>/, "la fusión debe leer la copia más reciente de la nube dentro de una transacción antes de escribir, para no perder un cambio del otro dispositivo");
  assert.match(firebase, /onSnapshot\(shortcutsDocument\(\)/);
  assert.match(firebase, /saveNoteSettings,\s*saveNotificationSettings,\s*saveShoppingState,\s*saveShortcuts/, "saveShortcuts debe exportarse igual que el resto de ajustes sincronizados");
  const saveShortcutsSource = app.match(/function saveShortcuts\(\)\{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(saveShortcutsSource, "saveShortcuts debe existir en app.js");
  assert.match(saveShortcutsSource, /cloud\.saveShortcuts\(previous,shortcuts,shortcutsHidden\)/, "cada guardado local debe subirse también a la nube junto con la copia previa (para poder fusionar), y si está oculta la fila");
  assert.match(app, /onShortcuts:remote=>\{if\(remote&&Array\.isArray\(remote\.items\)\)/, "si la nube ya tiene accesos guardados, deben ganar sobre los locales de este dispositivo");
  assert.match(app, /else void cloud\.saveShortcuts\(\[\],shortcuts,shortcutsHidden\)\.then/, "si la nube está vacía, se sube lo que ya hubiera en este dispositivo (como altas) en vez de perderlo");
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

// Real reportado: dos móviles con Angeli abierto a la vez tocando los
// accesos directos casi al mismo tiempo — como el guardado en la nube era un
// setDoc() que sobrescribía {items,hidden} entero, el que guardaba en
// segundo lugar borraba sin avisar el cambio del primero (un acceso añadido
// o eliminado en el otro dispositivo desaparecía sin más). La corrección da
// a cada acceso un `id` estable y fusiona por id en vez de sobrescribir.
test("accesos directos: los accesos base y los presets siempre tienen un id estable", () => {
  assert.ok(DEFAULT_SHORTCUTS.every(item => typeof item.id === "string" && item.id.length > 0));
  const idsA = normalizeShortcuts(null).map(item => item.id);
  const idsB = normalizeShortcuts(null).map(item => item.id);
  assert.deepEqual(idsA, idsB, "dos dispositivos sin nada guardado deben caer en los mismos ids de DEFAULT_SHORTCUTS, o la primera sincronización los duplicaría");
});

test("accesos directos: un acceso antiguo sin id guardado en local recibe uno estable (no cambia en cada normalización)", () => {
  const legacy = [{ label: "Mis citas", command: "¿Qué tengo esta semana?" }];
  const first = normalizeShortcuts(legacy);
  const second = normalizeShortcuts(first);
  assert.equal(first[0].id, second[0].id);
});

test("diffShortcuts: detecta altas, bajas, ediciones y el orden deseado por id", () => {
  const before = [
    { id: "a", label: "Uno" },
    { id: "b", label: "Dos" }
  ];
  const after = [
    { id: "b", label: "Dos editado" },
    { id: "c", label: "Tres" }
  ];
  const diff = diffShortcuts(before, after);
  assert.deepEqual(diff.removed, ["a"]);
  assert.deepEqual(diff.added.map(item => item.id), ["c"]);
  assert.deepEqual(diff.edited.map(item => item.id), ["b"]);
  assert.deepEqual(diff.order, ["b", "c"]);
});

test("fusión de accesos directos: un acceso añadido en otro móvil no se pierde al guardar un cambio local", () => {
  // Los dos móviles arrancan con la misma base ya sincronizada.
  const base = [{ id: "a", label: "Uno" }, { id: "b", label: "Dos" }];

  // Móvil 1 borra "Dos" (edición local, todavía no ha llegado a la nube).
  const phone1Local = [{ id: "a", label: "Uno" }];
  const phone1Diff = diffShortcuts(base, phone1Local);

  // Mientras tanto, móvil 2 ya guardó en la nube un acceso nuevo "c".
  const remoteAfterPhone2 = [{ id: "a", label: "Uno" }, { id: "b", label: "Dos" }, { id: "c", label: "Tres" }];

  // Móvil 1 guarda su cambio: debe fusionarse sobre lo que YA hay en la
  // nube (con el "c" de móvil 2), no sobre su propia copia desactualizada.
  const merged = applyShortcutsDiff(remoteAfterPhone2, phone1Diff);
  assert.deepEqual(merged.map(item => item.id), ["a", "c"], "debe faltar \"b\" (lo borró móvil 1) pero conservar \"c\" (lo añadió móvil 2, que móvil 1 ni siquiera conocía)");
});

test("fusión de accesos directos: dos altas simultáneas en dispositivos distintos coexisten", () => {
  const base = [{ id: "a", label: "Uno" }];
  const phone1Local = [{ id: "a", label: "Uno" }, { id: "x", label: "Nuevo de móvil 1" }];
  const phone1Diff = diffShortcuts(base, phone1Local);
  const remoteAfterPhone2 = [{ id: "a", label: "Uno" }, { id: "y", label: "Nuevo de móvil 2" }];
  const merged = applyShortcutsDiff(remoteAfterPhone2, phone1Diff);
  assert.deepEqual(merged.map(item => item.id).sort(), ["a", "x", "y"]);
});

// Reportado en la 2ª auditoría (usabilidad): crear un acceso directo (y la
// opción "🎙️ Dictar acceso") usaba dos prompt() nativos seguidos — hasta
// después de dictar. Ahora usa el modal propio showShortcutEditor.
test("accesos directos: crear uno personalizado usa el modal propio, no prompt() nativo", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const createSource = app.match(/function createShortcut\(initial=""\)\{.*\}/)?.[0] || "";
  assert.ok(createSource, "createShortcut debe existir");
  assert.doesNotMatch(createSource, /\bprompt\(/, "createShortcut ya no debe usar prompt() nativo");
  assert.match(createSource, /ui\.showShortcutEditor\(\{command:initial,onSave:/, "debe usar el modal propio, precargando la orden dictada");
  assert.match(ui, /function showShortcutEditor\(\{ command = "", label = "", onSave, onCancel \} = \{\}\)/, "el editor propio debe existir");
  assert.match(ui, /showShortcutEditor,/, "y estar exportado");
  // El nombre se autocompleta a partir de la orden (no obliga a teclearlo).
  assert.match(ui, /const label = \$\("shortcutEditLabel"\)\.value\.trim\(\) \|\| command\.slice\(0, 24\)/, "el nombre se rellena solo desde la orden si se deja vacío");
});
