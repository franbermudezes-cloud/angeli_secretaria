import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_SHORTCUTS, normalizeShortcuts, routeShortcutIntent, shortcutPrefix, shortcutSemantics, shortcutType } from "../js/shortcuts.js";

test("una petición normal sin acceso directo no intenta leer action de null", () => {
  assert.equal(shortcutType(null), null);
  assert.equal(shortcutPrefix(null), "");
  assert.deepEqual(shortcutSemantics(null), { action: null, direct: false });
});

test("accesos directos: los seis accesos base conservan una intención explícita", () => {
  assert.deepEqual(DEFAULT_SHORTCUTS.map(item => item.action), [
    "calendar.query", "calendar.query", "contact.call", "calendar.create", "reminder.create", "calendar.delete"
  ]);
  assert.equal(shortcutPrefix(DEFAULT_SHORTCUTS[4]), "Recuérdame ");
  assert.equal(shortcutPrefix(DEFAULT_SHORTCUTS[3]), "Añade al calendario ");
  assert.equal(shortcutPrefix(DEFAULT_SHORTCUTS[5]), "Cancela ");
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
  const reminder = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[4], "Recuérdame comprar ruedas mañana a las diez de la mañana", now);
  assert.equal(reminder.intent, "reminder.create");
  assert.equal(reminder.date, "2026-09-01");
  assert.equal(reminder.time, "10:00");
  const call = routeShortcutIntent({ ...wrong, date: "2026-09-01", time: "10:00" }, DEFAULT_SHORTCUTS[2], "Llama a Monse", now);
  assert.equal(call.intent, "contact.call");
  assert.equal(call.date, null);
  assert.equal(call.time, null);
  assert.equal(call.contactName, "Monse");
  const event = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[3], "Añade al calendario cena con María mañana a las nueve de la noche", now);
  assert.equal(event.intent, "calendar.create");
  assert.equal(event.title, "cena con María mañana a las nueve de la noche");
  const query = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[0], "¿Qué tengo hoy?", now);
  assert.equal(query.intent, "calendar.query");
  assert.ok(query.rangeStart && query.rangeEnd);
  const cancellation = routeShortcutIntent(wrong, DEFAULT_SHORTCUTS[5], "Cancela cena con María", now);
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
