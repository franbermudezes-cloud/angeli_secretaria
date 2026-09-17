import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, ui, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../js/ui.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.match(html, /id="conversationModeOpen"/);
assert.match(html, /id="conversationMode"/);
assert.match(html, /id="conversationModeTranscript"/);
assert.match(html, /id="conversationModeStatus"/);
assert.match(html, /id="conversationModeMic"/);
assert.match(html, /id="conversationModeClose"/);

// Regresión: el botón de modo conversación sustituyó al saludo fijo, no
// convive con él (el usuario pidió expresamente quitar "Hola, dime lo que
// necesites" y subir el botón a ese hueco).
assert.doesNotMatch(html, /Hola, dime lo que necesites/);

assert.match(ui, /function openConversationMode/);
assert.match(ui, /function closeConversationMode/);
assert.match(ui, /function addConversationTurn/);

// El motor real vive en app.js y reutiliza add() tal cual (el intérprete y
// las confirmaciones de calendario/recordatorios no se tocan): un turno de
// conversación solo rellena #text y llama a add(), igual que hace el
// compositor normal.
assert.match(app, /function conversationRunTurn/);
assert.match(app, /\$\("text"\)\.value=text;finalText=text;/);
assert.match(app, /active\?await add\(\{interactionId:active\.id\}\):await add\(\)/);

// Regresión: en iOS/Safari el reconocimiento continuo (continuous:true) es
// poco fiable; se usa el mismo modo de una sola tanda que ya funciona en el
// dictado normal, encadenando tandas automáticamente en vez de mantener una
// sesión continua.
assert.match(app, /conversationRec\.continuous=false/);

// El modal de acción (#actionModal) debe quedar SIEMPRE por delante del
// panel de conversación a pantalla completa, o cualquier confirmación
// (crear evento, elegir nota, editor de nota…) quedaría oculta detrás de un
// fondo opaco sin que el usuario pueda tocarla.
const conversationModeZ = Number(css.match(/\.conversation-mode\{[^}]*z-index:(\d+)/)?.[1] || -1);
const actionModalZ = Number(css.match(/\.action-modal\{[^}]*z-index:(\d+)/)?.[1] || -1);
assert.ok(conversationModeZ >= 0 && actionModalZ >= 0, "deben existir ambas reglas de z-index");
assert.ok(conversationModeZ < actionModalZ, `.conversation-mode (z-index ${conversationModeZ}) debe quedar por detrás de .action-modal (z-index ${actionModalZ})`);

// Un modal con varias opciones (crear evento, elegir entre notas, editor de
// nota…) exige un toque en pantalla igual que hoy con el compositor normal:
// el modo conversación debe pausar el micrófono y esperar a que se cierre,
// nunca inventar un intento de responder por voz a ese tipo de decisiones.
assert.match(app, /function conversationModalKind/);
assert.match(app, /watchForModalClose/);

// Regresión (hallada por revisión externa antes de fusionar): openModal()
// limpiaba working-modal/conversation-modal/call-choice-modal pero no
// completion-modal. Esa clase se quedaba pegada tras la primera confirmación
// autocerrable, así que conversationModalKind() clasificaba CUALQUIER modal
// posterior como una simple confirmación y lo hablaba/cerraba solo, sin
// esperar la elección real que exigía (crear evento, elegir nota...).
assert.match(ui, /classList\.remove\("working-modal", "conversation-modal", "call-choice-modal", "completion-modal"\)/);

// Regresión: parar el micrófono a mano (stopConversationRecognizer) también
// dispara el propio onend del reconocedor, que sin distinguir un stop manual
// de un final de frase natural relanzaba la escucha, ignorando la pausa.
assert.match(app, /conversationManualStop=true/);
assert.match(app, /const manualStop=conversationManualStop/);
assert.match(app, /if\(!manualStop&&!conversationTurnDispatched/);

// Regresión: cerrar el modo conversación con una pregunta de aclaración
// abierta solo ocultaba el modal, dejando la interacción "awaiting_input" en
// los datos; al reabrir el modo, una frase nueva sin relación se colaba como
// respuesta a esa pregunta vieja. Cerrar debe cancelar esa interacción, no
// solo esconder el modal.
const closeConversationSource = app.match(/function closeConversationModeReal\(\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(closeConversationSource, "closeConversationModeReal debe existir");
assert.match(closeConversationSource, /conversationActiveQuestionEntry\(\)/);
assert.match(closeConversationSource, /cancelActive\(active\)/);

console.log("conversation-mode: ok");
