import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromCloudEntry, toCloudEntry } from "../js/cloud-entry.js";
import { mediaContextComplete, mediaContextRelation, normalizeMediaContext } from "../js/media-context.js";

const settings = {
  categories: [{ id: "personal", label: "Personal" }, { id: "company", label: "Empresa" }],
  relationTypes: [{ id: "client", label: "Cliente" }, { id: "project", label: "Proyecto" }]
};
const context = normalizeMediaContext({ purpose: "  Presupuesto de iluminación ", scope: "company", relationType: "client", relationName: "  Ana " }, settings);
assert.deepEqual(context, { purpose: "Presupuesto de iluminación", scope: "company", categoryLabel: "Empresa", relationType: "client", relationTypeLabel: "Cliente", relationName: "Ana" });
assert.equal(mediaContextComplete(context), true);
assert.equal(mediaContextComplete({ purpose: "Contrato", relationType: "client", relationName: "" }), false);
assert.equal(mediaContextRelation(context), "Cliente: Ana");
assert.deepEqual(fromCloudEntry(toCloudEntry({ id: "entry", mediaContext: context }), "entry").mediaContext, context);

// Regresión real encontrada probando la app en producción: adjuntar una foto
// o archivo desde el compositor (sin pasar por una nota) llama a
// normalizeMediaContext con pendingMediaContext, que empieza en null. Un
// "= {}" en la firma no cubre null (solo undefined), así que la primera
// clasificación de cualquier adjunto suelto reventaba y el modal nunca
// llegaba a abrirse, dejando a la persona sin forma de continuar.
assert.doesNotThrow(() => normalizeMediaContext(null, settings));
const fromNull = normalizeMediaContext(null, settings);
assert.equal(fromNull.scope, "personal");
assert.equal(fromNull.purpose, "");
assert.equal(mediaContextRelation(null), "");

// Real reportado por el propietario: hacer una foto con la cámara y luego
// añadir también fotos de la galería (o al revés) perdía en silencio lo
// elegido primero — prepareMedia sustituía pendingImages/pendingFiles
// entero por lo último elegido en vez de sumarlo, así que la primera foto
// nunca llegaba a subirse ni avisaba de que se había perdido.
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const prepareMediaSource = app.match(/function prepareMedia\(files,kind,message\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(prepareMediaSource, "prepareMedia debe existir");
assert.match(prepareMediaSource, /pendingImages=\[\.\.\.pendingImages,\.\.\.files\]/, "las fotos nuevas deben sumarse a las ya elegidas, no sustituirlas");
assert.match(prepareMediaSource, /pendingFiles=\[\.\.\.pendingFiles,\.\.\.files\]/, "los archivos nuevos deben sumarse a los ya elegidos, no sustituirlos");

// Pedido explícito: poder crear un tipo de relación nuevo (p. ej. "Familia")
// en el momento de clasificar un adjunto, sin tener que ir antes a Ajustes.
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
assert.match(ui, /<option value="__new__">\+ Nuevo tipo…<\/option>/, 'el selector de "Relacionado con" debe ofrecer crear uno nuevo');
assert.match(ui, /id="mediaContextRelationTypeNew"/);
const askMediaContextSource = app.match(/async function askMediaContext\(\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(askMediaContextSource, "askMediaContext debe existir");
assert.match(askMediaContextSource, /addNoteSetting\(noteSettings,"relationTypes",values\.newRelationType\)/, "el tipo nuevo debe crearse de verdad en los ajustes de notas, no solo usarse una vez");
assert.match(askMediaContextSource, /await saveNoteSettings\(/, "debe persistir el nuevo tipo, no solo guardarlo en memoria");

// Real reportado por el propietario, con captura de pantalla: tras
// clasificar una foto, se quedaba como miniatura fija encima del footer,
// sin ninguna forma visible de enviarla ni de que desapareciera de ahí.
// Causa: desde que el rediseño de la pantalla principal (V0.21.87) ocultó
// el compositor fijo con el botón Enviar, ningún paso volvía a abrirlo tras
// clasificar un adjunto — la foto se quedaba huérfana en #preview para
// siempre, y el aviso "puedes... enviarlo" prometía algo que no existía en
// pantalla.
assert.match(askMediaContextSource, /openDraft\(\);/, "debe abrir el borrador (con su botón Enviar) justo después de clasificar, o la foto se queda sin forma de enviarse");

console.log("media-context: ok");
