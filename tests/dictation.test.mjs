import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

// Real reportado por el propietario: dictando una instrucción/nota general
// ("Toca para hablar"), el micro cortaba a los 1-3 segundos, no por una
// pausa suya sino porque continuous:false da la sesión por terminada nada
// más entregar un primer resultado "final" del reconocedor. Con
// continuous:true, start() sigue escuchando hasta que la persona toca el
// micro para parar o pulsa Enviar — puede pensar a mitad de frase sin que
// se corte el dictado.
const startSource = app.match(/function start\(\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(startSource, "start() debe existir");
assert.match(startSource, /rec\.continuous=true/, "el dictado general no debe cortarse tras el primer resultado final");

// El modo conversación y el micro rápido de la lista de la compra son
// intencionalmente distintos: cada sesión de reconocimiento ahí es UNA sola
// orden completa, así que continuous:false sigue siendo lo correcto — no
// deben tocarse por este mismo cambio.
assert.match(app, /conversationRec\.continuous=false;/, "el modo conversación sigue siendo una orden por sesión, a propósito");
assert.match(app, /rec\.lang="es-ES";rec\.continuous=false;rec\.interimResults=false;rec\.maxAlternatives=1;/, "el micro rápido de la lista de la compra sigue siendo una sola frase por sesión, a propósito");

// Hallazgo de la auditoría completa del código: cancelar o guardar un
// borrador (el modal "Te escucho", la pregunta de aclaración, o los
// editores de campo de Calendar/WhatsApp) nunca paraba el reconocedor de
// voz si seguía escuchando en ese momento — se quedaba huérfano en segundo
// plano. El primer toque en OTRO micrófono entonces solo apagaba ese
// fantasma (start() se autoapaga si `listening` es true) sin arrancar
// nada — hacía falta un segundo toque para que el nuevo micrófono
// funcionara de verdad.
assert.match(app, /function stopStrayDictation\(\)\{if\(listening\)stop\(\)\}/, "debe existir un único punto que pare el dictado general huérfano");
for (const site of [
  /onCancel:\(\)=>\{stopStrayDictation\(\);pendingShortcut=null;ui\.closeLayers\(\)\}/,
  /onCancel:\(\)=>\{stopStrayDictation\(\);cancelActive\(entry\)\}/,
  /function clearComposer\(\)\{stopStrayDictation\(\);/,
  /function shoppingQuickMic\(\)\{\n stopStrayDictation\(\);/
]) {
  assert.match(app, site, `falta llamar a stopStrayDictation() en: ${site}`);
}
// Los 4 editores de campo (Calendar título/ubicación/descripción, fecha y
// hora, mensaje de WhatsApp, número de WhatsApp) comparten el mismo patrón
// de "onCancel"/"onSave" que reabre showEntryAction — los 4 deben parar
// cualquier dictado huérfano antes de cambiar de pantalla.
const onCancelShowEntryActionCount = (app.match(/onCancel:\(\)=>\{stopStrayDictation\(\);ui\.showEntryAction\(/g) || []).length;
assert.equal(onCancelShowEntryActionCount, 4, "los 4 editores de campo (calendar-field, calendar-datetime, whatsapp, whatsapp-phone) deben parar el dictado huérfano al cancelar");

console.log("dictation: ok");
