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

console.log("media-context: ok");
