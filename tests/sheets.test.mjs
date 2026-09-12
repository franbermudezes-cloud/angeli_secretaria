import assert from "node:assert/strict";
import test from "node:test";
import { sheetsPayload } from "../js/sheets.js";

test("registra nombres y enlaces de fotos y archivos en el orden de la entrada",()=>{
 const payload=sheetsPayload({
  id:"entry-1",text:"Documentación",type:"file",
  images:[{name:"foto.jpg",url:"https://drive.google.com/file/d/foto/view"}],
  files:[{name:"contrato.pdf",driveFileId:"archivo-id"}]
 },new Date("2026-09-12T15:30:00+02:00"));
 assert.equal(payload.archivo,"foto.jpg · contrato.pdf");
 assert.equal(payload.enlace,"https://drive.google.com/file/d/foto/view · https://drive.google.com/file/d/archivo-id/view");
});

test("mantiene vacíos los campos de adjuntos para una entrada de texto",()=>{
 const payload=sheetsPayload({id:"entry-2",text:"Comprar pan",type:"note"},new Date("2026-09-12T15:30:00+02:00"));
 assert.equal(payload.archivo,"");
 assert.equal(payload.enlace,"");
});
