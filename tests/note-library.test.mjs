import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");

assert.match(html, /id="noteLibrary"/);
assert.match(html, /data-note-status="pending"/);
assert.match(html, /data-note-status="done"/);
assert.match(html, /id="noteLibraryCategory"/);
assert.match(app, /\$\("notesOpen"\)\.onclick=openNoteLibrary/);
assert.match(app, /showMediaEntryDetail/);
assert.match(app, /showMediaContextEditor\(\{files:\[item\.name\]/);
assert.match(ui, /data-note-action="edit"/);
assert.match(ui, /Clasificar ahora/);
assert.match(ui, /Modificar clasificación/);
assert.match(ui, /id="noteDraftImages"/);
assert.match(ui, /id="noteDraftFiles"/);
assert.match(ui, /Añadir nota/);
assert.match(app, /uploadNoteAttachments/);
assert.match(app, /type:"note"/);

// Hallazgo de la auditoría completa del código: al guardar una nota editada
// desde la biblioteca de notas, editNoteFromLibrary siempre hacía
// closeLayers() + refreshNoteLibrary() sin importar desde dónde se había
// abierto — refreshNoteLibrary() solo actualiza el HTML de una biblioteca
// que en ese momento está oculta, así que guardar dejaba a la persona en la
// pantalla de inicio sin ninguna confirmación visible del cambio.
const editNoteFromLibrarySource = app.match(/function editNoteFromLibrary\(entry,onCancel,onSaved\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(editNoteFromLibrarySource, "editNoteFromLibrary debe aceptar un tercer parámetro onSaved");
assert.match(editNoteFromLibrarySource, /if\(onSaved\)onSaved\(updated\);else\{ui\.closeLayers\(\);refreshNoteLibrary\(\)\}/, "quien llama debe poder decidir a qué pantalla volver tras guardar");
assert.match(app, /onEdit:\(\)=>editNoteFromLibrary\(entry,show,updated=>\{entry=updated;ui\.closeLayers\(\);show\(\)\}\)/, "editar desde la ficha de una nota debe volver a esa misma ficha, ya actualizada, tras guardar");
assert.match(app, /const backToLibrary=\(\)=>\{ui\.closeLayers\(\);ui\.openNoteLibrary\(noteLibraryItems\(\),noteLibraryState\)\};editNoteFromLibrary\(entry,backToLibrary,backToLibrary\)/, "editar desde la propia lista debe volver a la biblioteca, ya refrescada, tanto al cancelar como al guardar");

console.log("note-library: ok");
