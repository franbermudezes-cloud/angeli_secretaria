import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REMINDER_TRIGGER, REMINDER_CLASSIFY_TRIGGER, REMINDER_SHORTCUT_TRIGGER } from "../js/keywords.js";
import { classify } from "../js/classifier.js";
import { shortcutSemantics } from "../js/shortcuts.js";
import { explicitNewCommandDomain, localReminderQuery, localNoteQuery, localImmediateCall } from "../js/ai.js";

// Hallazgo de "calidad de código" de la auditoría completa: el disparador de
// "esto habla de un recordatorio" vivía repetido (a veces literalmente
// idéntico, a veces con pequeñas variaciones) en js/ai.js (4 copias, dos de
// ellas incluso escritas de formas distintas: [eé] vs [eé]),
// js/classifier.js y js/shortcuts.js — ya causó una regresión real (V0.22.4:
// el guard de "recuérdame" tuvo que parchearse por separado en dos funciones
// de ai.js con su propia copia pegada). Se centralizan en js/keywords.js sin
// cambiar ningún comportamiento — cada constante conserva exactamente las
// mismas palabras que tenía en su sitio original.
test("REMINDER_TRIGGER: reconoce recuérdame/recuerda/acuérdate, con o sin pronombre pegado", () => {
  assert.equal(REMINDER_TRIGGER.test("Recuérdame llamar al médico"), true);
  assert.equal(REMINDER_TRIGGER.test("recuérdamelo mañana"), true);
  assert.equal(REMINDER_TRIGGER.test("recuérdamela el viernes"), true);
  assert.equal(REMINDER_TRIGGER.test("Recuerda comprar leche"), true);
  assert.equal(REMINDER_TRIGGER.test("Acuérdate de llamar a Ana"), true);
  assert.equal(REMINDER_TRIGGER.test("Cámbiame el turno del trabajo"), false);
});

test("REMINDER_CLASSIFY_TRIGGER: igual que REMINDER_TRIGGER más el verbo suelto recordar (lo que ya usaba classify())", () => {
  assert.equal(REMINDER_CLASSIFY_TRIGGER.test("recuérdame llamar a ana"), true);
  assert.equal(REMINDER_CLASSIFY_TRIGGER.test("recordar la reunión"), true);
});

test("REMINDER_SHORTCUT_TRIGGER: reconoce recordatorio/recuerdame/avisame sin acentos (lo que ya usaba shortcutSemantics())", () => {
  assert.equal(REMINDER_SHORTCUT_TRIGGER.test("recordatorio itv"), true);
  assert.equal(REMINDER_SHORTCUT_TRIGGER.test("avisame del cumpleaños"), true);
});

// Las tres funciones que consumen estas constantes deben seguir
// comportándose exactamente igual que antes de centralizarlas — este es un
// refactor de "calidad de código" puro, no debe cambiar nada observable.
test("classify() sigue reconociendo un recordatorio igual que antes de centralizar la palabra clave", () => {
  assert.equal(classify("recuérdame llamar a Ana"), "reminder");
  assert.equal(classify("recordar la ITV del coche"), "reminder");
  assert.equal(classify("comprar leche"), "task");
});

test("shortcutSemantics() sigue reconociendo un acceso directo de recordatorio igual que antes", () => {
  assert.deepEqual(shortcutSemantics({ label: "Recordatorio ITV" }), { action: "reminder.create", direct: false });
  assert.deepEqual(shortcutSemantics({ label: "Avisame del cumpleaños" }), { action: "reminder.create", direct: false });
});

test("los guards de ai.js (localReminderQuery/localNoteQuery/localImmediateCall/explicitNewCommandDomain) siguen funcionando igual tras reutilizar REMINDER_TRIGGER", () => {
  assert.equal(localReminderQuery("Recuérdame que revise los recordatorios del banco el viernes"), null, "sigue sin confundirse con una consulta vacía");
  assert.equal(localNoteQuery("Recuérdame que revise mis notas del banco el viernes"), null, "sigue sin confundirse con una consulta de notas");
  assert.equal(localImmediateCall("Recuérdame llamar a Ana"), null, "sigue sin confundirse con una llamada inmediata");
  assert.equal(explicitNewCommandDomain("Recuérdame llamar al médico mañana"), "reminder");
});

// Confirma que ya no quedan copias sueltas del mismo patrón fuera de
// js/keywords.js — si alguien vuelve a pegarlo en vez de importar, este test
// debería fallar y avisar.
test("el patrón de REMINDER_TRIGGER ya no está copiado y pegado por separado dentro de js/ai.js", () => {
  const ai = readFileSync(new URL("../js/ai.js", import.meta.url), "utf8");
  const inlineCopies = (ai.match(/recu\[e[é\\]/g) || []).length;
  assert.equal(inlineCopies, 0, "ninguna copia suelta del patrón debe quedar en ai.js — solo la importación de REMINDER_TRIGGER");
  assert.match(ai, /import\{REMINDER_TRIGGER\}from"\.\/keywords\.js/);
});

console.log("keywords: ok");
