import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { filterMediaLibrary, mediaLibraryItems, mediaSize } from "../js/media-library.js";

const items = mediaLibraryItems([
  { id: "n1", date: "2026-09-12T10:00:00Z", text: "Contrato de Ana", type: "note", noteClassification: { scope: "personal", categoryLabel: "Personal" }, images: [{ driveFileId: "i1", name: "firma.jpg", type: "image/jpeg", size: 2048 }], files: [{ id: "f1", name: "contrato.pdf", type: "application/pdf", size: 1500000 }] },
  { id: "n2", date: "2026-09-13T10:00:00Z", text: "Foto del montaje", type: "photo", images: ["legacy-id"] }
]);

assert.equal(items.length, 3);
assert.equal(items[0].driveId, "legacy-id");
assert.equal(items[1].category, "personal");
assert.equal(filterMediaLibrary(items, { kind: "file" }).length, 1);
assert.equal(filterMediaLibrary(items, { category: "personal" }).length, 2);
assert.equal(filterMediaLibrary(items, { query: "ana" }).length, 2);
assert.equal(mediaSize(2048), "2 KB");
assert.equal(mediaSize(1500000), "1.4 MB");

const [html, app, serviceWorker] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8")
]);
assert.match(html, /id="mediaLibrary"/);
assert.match(html, /data-library-kind="image"/);
assert.match(html, /id="viewerShare"/);
assert.match(html, /id="galleryOpen"/);
assert.match(html, /id="filesOpen"/);
assert.match(html, /id="notesOpen"/);
assert.match(html, /id="remindersOpen"/);
assert.match(html, /id="menuOpen"/);
assert.doesNotMatch(html, /id="headerSend"/);
assert.doesNotMatch(html, /id="searchToggle"/);
assert.match(app, /navigator\.share\(\{files:\[file\]/);
assert.match(app, /ui\.showMediaViewer/);
assert.match(serviceWorker, /js\/media-library\.js/);

console.log("media-library: ok");
