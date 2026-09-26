import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Pedido por el propietario: fuera del modo conversación, cuando se DICTA con
// el micrófono normal, Angeli contesta con una frase corta y no se queda
// escuchando. Si se escribe, no habla. Contestar a «¿A qué hora?» sigue igual.
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("solo habla si se ha dictado, fuera del modo conversación y con la opción activada", () => {
  assert.match(app, /const speak=composerDictated&&!conversationOn&&voicePrefs\.speakReplies!==false;\n composerDictated=false;\n await addEntry\(options\);\n if\(speak\)await speakBriefOutcome\(\);/);
  assert.match(app, /rec\.onresult=e=>\{idleSessions=0;composerDictated=true;/);
});

test("dice el resultado, la pregunta o la confirmación, y nunca reanuda la escucha", () => {
  const brief = app.match(/async function speakBriefOutcome\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(brief, /kind==="completion"/);
  assert.match(brief, /kind==="question"\)text=lead\|\|title/);
  assert.match(brief, /toast/);
  assert.doesNotMatch(brief, /resumeConversationListening|startConversationRecognizer|start\(/);
});

test("al tocar un micrófono Angeli se calla para no oírse a sí misma", () => {
  assert.match(app, /function start\(\{inConversation=false,draftId=null\}=\{\}\)\{[^\n]*if\(dictationMic\.isActive\(\)\)\{stop\(\);return\}stopSpeaking\(\);unlockAngeliAudio\(\);/);
});

test("se puede desactivar en Ajustes → Voz", () => {
  assert.match(html, /<input id="voiceReplies" type="checkbox" checked>/);
  assert.match(app, /voicePrefs\.speakReplies=\$\("voiceReplies"\)\.checked;saveVoicePrefs\(\)/);
});
