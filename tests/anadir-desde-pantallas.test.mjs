import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Pedido por el propietario: desde las pantallas de arriba (fotos, archivos,
// notas, recordatorios) solo se podía mirar. Cada una tiene su «＋».
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");

test("fotos/archivos y notas tienen su botón ＋ junto a cerrar", () => {
  assert.match(html, /<button id="libraryAdd" class="icon-button" aria-label="Añadir foto o archivo">＋<\/button><button id="libraryClose"/);
  assert.match(html, /<button id="noteLibraryAdd" class="icon-button" aria-label="Añadir nota">＋<\/button><button id="noteLibraryClose"/);
});

test("cada ＋ abre lo mismo que el resto de la app, sin caminos nuevos", () => {
  assert.match(app, /if\(libraryState\.kind==="image"\)return pick\("photoInput"\);/);
  assert.match(app, /if\(libraryState\.kind==="file"\)return pick\("fileInput"\);/);
  assert.match(app, /const pick=input=>\{ui\.closeMediaLibrary\(\);\$\(input\)\.click\(\)\};/, "cierra la pantalla para que no tape lo siguiente");
  assert.match(app, /\$\("noteLibraryAdd"\)\.onclick=\(\)=>\{ui\.closeNoteLibrary\(\);newNoteDraft\(\)\};/);
  assert.match(app, /\$\("remindersOpen"\)\.onclick=\(\)=>void resolveReminderQuery\(localReminderQuery\("Recordatorios pendientes"\),\{onAdd:newReminderDraft\}\);/);
});

test("recordatorios: ＋ Nuevo recordatorio, también cuando no hay ninguno", () => {
  assert.match(ui, /const addAction = onAdd \? \[\{ label: "＋ Nuevo recordatorio"/);
  assert.match(ui, /if \(!matches\.length && onAdd\) \{/);
});
