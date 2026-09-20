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

console.log("dictation: ok");
