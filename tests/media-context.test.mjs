import assert from "node:assert/strict";
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

console.log("media-context: ok");
