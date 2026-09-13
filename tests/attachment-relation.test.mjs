import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planIntent } from "../js/intents.js";

// Regresión: guardar una foto o un archivo suelto (sin convertirlo en nota),
// o una tarea sin fecha, mostraba un mensaje fijo sin ningún dato real
// ("Guardado — La entrada se ha guardado en tu conversación"), porque
// intents.js nunca definió una descripción para photo.store/file.store
// (caían en el valor por defecto "Nota preparada", que ni siquiera es
// correcto) y ui.js ignoraba esa descripción en la confirmación final.
const photo = planIntent({ intent: "photo.store" });
assert.equal(photo.description, "Guardar foto");
const file = planIntent({ intent: "file.store" });
assert.equal(file.description, "Guardar archivo");

const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

// La confirmación genérica de showEntryAction debe mostrar el contenido real
// (entryBody, que incluye tipo, descripción y contexto de clasificación) en
// vez de un texto fijo que no dice nada de lo que se acaba de guardar.
assert.match(ui, /showCompletion\(\{ title: "✓ Guardado en Angeli", lead: "Ya está sincronizado en tu conversación\.", body: entryBody\(note\) \}\)/);
assert.doesNotMatch(ui, /La entrada se ha guardado en tu conversación\./);

// La ficha de un adjunto debe decir explícitamente con qué está relacionado
// (una nota concreta, o la persona/cliente/proyecto elegido al clasificarlo),
// no solo insinuarlo con la etiqueta de un botón.
assert.match(ui, /function mediaRelationCard/);
assert.match(ui, /Vinculado a la nota/);
assert.match(ui, /mediaRelationCard\(entry\)/);

// El listado de Galería/Archivos debe distinguir a simple vista los
// adjuntos que pertenecen a una nota.
assert.match(ui, /Nota vinculada/);
assert.match(ui, /item\.entryType === "note"/);

console.log("attachment-relation: ok");
