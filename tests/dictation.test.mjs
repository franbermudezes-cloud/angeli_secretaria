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
// Real reportado por el propietario: en el móvil (Chrome de Android) el dictado
// repetía palabras "como si hubiera cincuenta micros", y confirmó que ANTES no
// pasaba — hasta que se cambió a continuous:true (puesto para que el micro del
// ordenador no se cortara tras el primer resultado). continuous:true en Android
// encadena cada interino/final que crece como resultados separados, y cualquier
// suma los multiplica. Solución por plataforma:
//   · Ordenador: continuous:true, una sesión, segmentos distintos -> concatenar.
//   · Móvil: continuous:false (como antes), un enunciado por sesión, se toma el
//     ÚLTIMO resultado (asignar, no sumar) y se REINICIA en onend para no cortar.
assert.match(startSource, /rec\.continuous=!isMobileDictation/, "el dictado usa continuous en el ordenador y por enunciado en el móvil");
assert.match(startSource, /isMobileDictation=\/Android\|iPhone\|iPad\|iPod\/i\.test/, "debe detectar el móvil para elegir el modo");
// En el móvil se ASIGNA el último resultado (nunca se suman los que crecen).
assert.match(startSource, /if\(r\.isFinal\)finalPart=phrase;else live=phrase/, "en el móvil se toma el último resultado, no la suma (evita la duplicación)");
// El reinicio en onend es lo que mantiene el dictado largo sin cortarse.
assert.match(startSource, /if\(isMobileDictation&&dictationMic\.isActive\(\)&&rec===recognizer\)\{try\{recognizer\.start\(\);return\}/, "en el móvil se reinicia el reconocedor mientras la persona no haya parado");
// En el ordenador se concatenan los segmentos distintos de la única sesión.
assert.match(startSource, /finals\+=\(finals\?" ":""\)\+phrase/, "en el ordenador (continuous) los segmentos distintos se concatenan");
assert.doesNotMatch(startSource, /for\(let i=e\.resultIndex/, "el dictado general no debe volver a depender de e.resultIndex");

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
assert.match(app, /function stopStrayDictation\(\)\{if\(dictationMic\.isActive\(\)\)stop\(\)\}/, "debe existir un único punto que pare el dictado general huérfano");
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

// Hallazgo de "calidad de código" de la auditoría completa: si el
// micrófono del compositor está escuchando vivía como una variable global
// suelta (`listening`), tocada directamente desde cinco sitios (start,
// stop, y los tres manejadores rec.onstart/onerror/onend) — la misma clase
// de fallo que ya causó el bug de "micrófonos huérfanos" (V0.21.95,
// V0.22.5). Se agrupa en un objeto (`dictationMic`) con métodos explícitos.
assert.doesNotMatch(app, /let notes=\[\],rec=null,listening=false/, "\"listening\" ya no debe ser una variable global suelta");
assert.match(app, /const dictationMic=\{active:false,isActive\(\)\{return this\.active\},set\(value\)\{this\.active=value\}\};/, "debe existir el objeto que centraliza el estado");
for (const site of [
  /function stop\(\)\{dictationMic\.set\(false\);/,
  /function start\(\{inConversation=false,draftId=null\}=\{\}\)\{const SR=window\.SpeechRecognition\|\|window\.webkitSpeechRecognition;if\(dictationMic\.isActive\(\)\)\{stop\(\);return\}/,
  /rec\.onstart=\(\)=>\{dictationMic\.set\(true\);setMicState\(true\);/,
  /rec\.onerror=e=>\{const fatal=[\s\S]*?dictationMic\.set\(false\);setMicState\(false\);/,
  /rec\.onend=\(\)=>\{finalText=[\s\S]*?dictationMic\.set\(false\);setMicState\(false\);/,
  /try\{rec\.start\(\)\}catch\(e\)\{dictationMic\.set\(false\);setMicState\(false\);ui\.notify\("No se pudo iniciar el dictado"\)\}\}/
]) {
  assert.match(app, site, `falta usar dictationMic en: ${site}`);
}

console.log("dictation: ok");
