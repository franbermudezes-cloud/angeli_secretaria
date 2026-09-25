import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { routeShortcutIntent } from "../js/shortcuts.js";
import { resolveConversationTurn } from "../js/conversation.js";

// 3ª auditoría (regresiones de V0.23.2–0.23.4 halladas por el agente).
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const now = new Date(2026, 8, 25, 10);
const call = text => routeShortcutIntent({ intent: "contact.call", missingFields: [] }, { action: "contact.call", direct: true }, text, now);
const cancel = text => routeShortcutIntent({ intent: "calendar.delete" }, { action: "calendar.delete", direct: true }, text, now);

test("acceso directo «Llamar»: nombre limpio, número como teléfono, nombre vacío se pregunta, con fecha es aviso", () => {
  assert.deepEqual(call("Llama a").missingFields, ["contactName"]);
  assert.equal(call("Llama a").contactName, null, "antes buscaba el contacto «a»");
  assert.equal(call("Llama a Ana García al móvil").contactName, "Ana García");
  assert.equal(call("Llama a 612 345 678").phone, "612345678");
  const later = call("Llama a Ana mañana a las 10");
  assert.equal(later.date, "2026-09-26");
  assert.equal(later.time, "10:00", "con fecha y hora no es una llamada inmediata (normalizeFutureCall lo hace aviso)");
});

test("acceso directo «Cancelar evento»: «Cancela» a secas se pregunta; «lo de Miguel» busca Miguel", () => {
  assert.equal(cancel("Cancela").target, null);
  assert.deepEqual(cancel("Cancela").missingFields, ["target"]);
  assert.equal(cancel("Cancela lo de Miguel").target.title, "Miguel");
});

test("un acceso directo no se marca como «respaldo» (no muestra «Necesito asegurarme»)", () => {
  const turn = resolveConversationTurn({ text: "Llama a", interpretation: { intent: "contact.call", source: "shortcut", contactName: null, missingFields: ["contactName"], requiresConfirmation: true }, now: now.toISOString() });
  assert.equal(turn.interaction.source, "shortcut");
});

test("el acceso «🛒 Añadir a la compra» llega a la lista y los accesos sin dictado empiezan escuchando", () => {
  assert.match(app, /if\(!shortcutContext\?\.action&&!pendingImages\.length&&!pendingFiles\.length\)\{\n  const shoppingCommand=/);
  assert.match(app, /Voz primero: todos empiezan escuchando; el teclado sigue a un toque \(⌨️\)\. \*\/setTimeout\(start,120\);/);
});

test("dictado: escribir a mano lo para, Enviar siempre lo para, e iPad cuenta como móvil", () => {
  assert.match(app, /onInput:value=>\{if\(dictationMic\.isActive\(\)\)\{if\(rec\)rec\.discarded=true;stop\(\)\}/);
  assert.match(app, /mediaUploaded=false;if\(rec\)rec\.discarded=true;stopStrayDictation\(\);saving=true;/);
  assert.match(app, /\(\/Macintosh\/\.test\(navigator\.userAgent\)&&navigator\.maxTouchPoints>1\)/);
});
