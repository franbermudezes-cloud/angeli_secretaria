import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

// Petición del usuario: no quería quedarse con la voz que trae el teléfono
// por defecto. Una PWA no puede instalar voces nuevas (eso es del sistema
// operativo), pero sí puede recordar cuál de las YA instaladas prefiere, y a
// qué velocidad/tono — por eso el selector, no un simple interruptor.
assert.match(html, /id="voiceSelect"/);
assert.match(html, /id="voiceRate"[^>]*type="range"/);
assert.match(html, /id="voicePitch"[^>]*type="range"/);
assert.match(html, /id="voiceTest"/);

// Si el teléfono tiene pocas voces instaladas, la app debe explicar que
// descargar más es cosa de los ajustes del sistema, no de Angeli — nunca
// prometer una descarga que la web no puede hacer.
assert.match(html, /id="voiceSettingsHint"[^>]*hidden/);
assert.match(html, /la app no puede instalarlas/);

// La preferencia es de este dispositivo (voz/velocidad/tono), no un dato de
// Angeli: debe vivir en localStorage, nunca sincronizarse como si fuera una
// entrada más de Firestore.
assert.match(app, /const VOICE_PREF_KEY="angeliVoicePrefs";/);
assert.match(app, /localStorage\.setItem\(VOICE_PREF_KEY/);
assert.match(app, /localStorage\.getItem\(VOICE_PREF_KEY/);

// speakAloud() -usado tanto por el módulo de charla aparte como por las
// respuestas del modo conversación- debe aplicar la voz, velocidad y tono
// elegidos, no quedarse con los valores por defecto del navegador.
// Desde V0.26.2 la voz del teléfono vive en speakWithDevice (la de reserva
// cuando la voz propia de Angeli no está elegida o no responde).
const speakAloudSource = app.match(/function speakWithDevice\(text\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(speakAloudSource, "speakWithDevice debe existir");
assert.match(speakAloudSource, /utter\.voice=voice;/);
assert.match(speakAloudSource, /utter\.rate=voicePrefs\.rate\|\|1;/);
assert.match(speakAloudSource, /utter\.pitch=voicePrefs\.pitch\|\|1;/);

// selectedVoice() debe caer a una voz en español si el usuario no ha
// elegido ninguna todavía, en vez de quedarse con la primera voz de
// cualquier idioma que devuelva el navegador.
const selectedVoiceSource = app.match(/function selectedVoice\(\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(selectedVoiceSource, "selectedVoice debe existir");
assert.match(selectedVoiceSource, /startsWith\("es"\)/);

assert.match(css, /#voiceSelect\{/);
assert.match(css, /\.voice-slider-label\{/);

// Voz propia (Vindemiatrix): por defecto, con la del teléfono de reserva.
const speakSource = app.match(/async function speakAloud\(text\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(speakSource, /useAngeliVoice\(\)/);
assert.match(speakSource, /await fetchSpeech\(spoken/);
assert.match(speakSource, /await speakWithDevice\(spoken\)/, "si falla la voz propia, habla la del teléfono");
assert.match(app, /function useAngeliVoice\(\)\{return\(voicePrefs\.voiceURI\|\|ANGELI_VOICE\)===ANGELI_VOICE\}/, "la voz propia es la de por defecto");
assert.match(app, /unlockAngeliAudio\(\);\n ui\.openConversationMode\(\);/, "iOS: se desbloquea el audio en el toque");

console.log("voice-settings: ok");
