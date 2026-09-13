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
console.log("note-library: ok");
