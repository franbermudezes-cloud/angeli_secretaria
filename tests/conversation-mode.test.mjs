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

// Regresión real en dispositivo: con continuous:false, una frase algo larga
// ("llama a Vicente mañana") puede llegar en dos resultados "finales"
// separados por una pausa breve, antes de que la sesión termine. Sin
// comprobar conversationTurnDispatched al ENTRAR en onresult (no solo al
// marcarlo), el segundo resultado final disparaba un segundo
// conversationRunTurn en paralelo con el primero, duplicando la entrada
// guardada (dos recordatorios para la misma orden, con datos reales).
const onresultSource = app.match(/conversationRec\.onresult=event=>\{[\s\S]*?\n \};/)?.[0] || "";
assert.ok(onresultSource, "conversationRec.onresult debe existir");
assert.match(onresultSource, /if\(conversationTurnDispatched\)return;/, "debe descartar cualquier resultado posterior al primer turno ya lanzado");

// Petición del usuario: mientras Gemini responde, Angeli se quedaba callada
// (solo el modal en texto) y eso sonaba a "hablar contra una máquina". Debe
// decir SIEMPRE una coletilla nada más capturar la frase (no solo cuando
// tarda: hablar solo a veces seguía sonando a máquina el resto de veces),
// variada (varias frases, elegidas al azar) y con tono cercano, no robótico.
assert.match(app, /const CONVERSATION_FILLERS=\[/);
const fillersMatch = app.match(/const CONVERSATION_FILLERS=(\[[^\]]*\]);/);
assert.ok(fillersMatch, "debe existir la lista de coletillas");
const fillers = JSON.parse(fillersMatch[1].replace(/…/g, "..."));
assert.ok(fillers.length >= 5, "debe haber variedad real de coletillas, no una o dos repetidas siempre");
assert.ok(new Set(fillers).size === fillers.length, "las coletillas no deben repetirse entre sí");
const conversationRunTurnSource = app.match(/async function conversationRunTurn\(text\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(conversationRunTurnSource, "conversationRunTurn debe existir");
assert.match(conversationRunTurnSource, /void speakConversationalAside\(text\);/, "la coletilla debe decirse siempre, sin condicionarla a que Gemini tarde");
assert.doesNotMatch(conversationRunTurnSource, /setTimeout/, "no debe depender directamente de un temporizador de retraso");

// Módulo aparte y deliberadamente desacoplado del intérprete de órdenes
// (backend/app.py: /chat/aside): genera una reacción corta real en vez de
// una lista fija, pero nunca puede ser la causa de que Angeli se quede
// callada — si tarda más de un margen corto o falla, cae a la lista fija de
// siempre. Verificado también en el backend (test_chat_aside.py) que esta
// ruta nunca ejecuta el intérprete de órdenes.
assert.match(app, /import\{interpret,remoteProvider,chatAside,/, "chatAside debe importarse de ai.js junto al resto de la IA");
const asideSource = app.match(/async function speakConversationalAside\(text\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(asideSource, "speakConversationalAside debe existir");
assert.match(asideSource, /Promise\.race\(/, "debe competir contra un margen de tiempo corto, no esperar indefinidamente a la red");
assert.match(asideSource, /catch\(e\)\{/, "cualquier fallo de red o timeout debe capturarse");
assert.match(asideSource, /pickConversationFiller\(\)/, "el respaldo ante un fallo debe seguir siendo la lista fija ya probada");

// Petición del usuario: cuando hace falta tocar la pantalla (crear un
// evento, completar una nota, elegir entre varias...), Angeli decía siempre
// la misma frase genérica ("elige una opción en la pantalla"), sin relación
// con si era una nota, un recordatorio o lo que fuera. El propio modal ya
// trae un título y una explicación concretos para cada caso — ahora deben
// leerse tal cual, y nombrar el botón principal ("confirm"/"danger") cuando
// exista, para saber exactamente qué tocar.
const manualBranchSource = app.match(/if\(kind==="manual"\)\{[\s\S]*?\n \}/)?.[0] || "";
assert.ok(manualBranchSource, "la rama \"manual\" de conversationHandleOutcome debe existir");
assert.doesNotMatch(manualBranchSource, /Necesito que elijas una opción en la pantalla para continuar\./, "ya no debe decir siempre la misma frase genérica sin relación con el caso");
assert.match(manualBranchSource, /\$\("modalTitle"\)\.textContent/, "debe leer el título real del modal, específico de cada caso");
assert.match(manualBranchSource, /\$\("modalLead"\)\.textContent/, "debe leer la explicación real del modal, específica de cada caso");
assert.match(manualBranchSource, /button\.confirm, button\.danger/, "debe identificar el botón de acción principal para nombrarlo");
assert.match(manualBranchSource, /await speakAloud\(spoken\);/, "debe hablar el título\\/explicación real, no una frase fija");

// Real reportado por el propietario: al pedir algo en modo conversación que
// necesitaba un dato más, el modal de pregunta (showInteractionQuestion, que
// trae su propio cuadro de texto y su propio botón "🎙️ Hablar") se abría a
// la vez que se reanudaba el micrófono de FONDO del modo conversación
// (resumeConversationListening()) — dos SpeechRecognition compitiendo por
// el mismo micrófono. Tocar el micro del modal fallaba en silencio (el
// reconocedor de fondo ya tenía el micrófono ocupado), así que hablar no
// escribía nada y la instrucción se quedaba sin poder terminarse. La rama
// "question" debe esperar a que ESE modal se cierre antes de reanudar la
// escucha de fondo, igual que ya hace la rama "manual".
const questionBranchSource = app.match(/if\(kind==="question"\)\{[\s\S]*?\n \}/)?.[0] || "";
assert.ok(questionBranchSource, 'la rama "question" de conversationHandleOutcome debe existir');
assert.doesNotMatch(questionBranchSource, /^\s*resumeConversationListening\(\);/m, "no debe reanudar el micrófono de fondo mientras el modal con su propio micro sigue abierto");
assert.match(questionBranchSource, /watchForModalClose\(\(\)=>\{if\(conversationOn\)resumeConversationListening\(\)\}\)/, "debe esperar a que el modal se cierre, igual que la rama \"manual\"");

// Segundo real reportado en el mismo mensaje: el cuadro de texto del modal
// se abría sin el cursor puesto — escribir a mano exigía tocar el cuadro
// primero, y ni siquiera dictar por voz se notaba a simple vista si no se
// había mirado el cuadro antes de hablar.
const showInteractionQuestionSource = ui.match(/function showInteractionQuestion\([\s\S]*?\n  \}/)?.[0] || "";
assert.ok(showInteractionQuestionSource, "showInteractionQuestion debe existir");
assert.match(showInteractionQuestionSource, /draft\.focus\(\);/, "el cuadro de texto debe quedar enfocado en cuanto se abre el modal");

// El propietario avisó de que este mismo fallo (cuadro de texto sin el
// cursor puesto) se repetiría en cualquier otro modal con su propio campo
// de escritura si no se corregía en todos a la vez — no solo en el de la
// pregunta de aclaración.
for (const [name, focusTarget] of [
  ["showCalendarFieldEditor", "draft"],
  ["showCalendarDateTimeEditor", "date"],
  ["showWhatsAppEditor", "draft"],
  ["showWhatsAppPhoneEditor", "phone"]
]) {
  const source = ui.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`))?.[0] || "";
  assert.ok(source, `${name} debe existir`);
  assert.match(source, new RegExp(`${focusTarget}\\.focus\\(\\);`), `${name} debe dejar su campo enfocado en cuanto se abre`);
}

console.log("conversation-mode: ok");
