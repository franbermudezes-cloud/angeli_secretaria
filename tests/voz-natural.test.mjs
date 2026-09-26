import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { speechText, spokenClock } from "../js/speech.js";

// «Suena muy robótico» (el propietario): la voz del móvil leía los símbolos y
// las horas como un reloj digital. Lo escrito en pantalla no cambia.
test("las horas se dicen como las diría una persona", () => {
  assert.equal(spokenClock(21, 0), "las nueve de la noche");
  assert.equal(spokenClock(13, 0), "la una del mediodía");
  assert.equal(spokenClock(17, 30), "las cinco y media de la tarde");
  assert.equal(spokenClock(9, 15), "las nueve y cuarto de la mañana");
  assert.equal(spokenClock(20, 45), "las nueve menos cuarto de la noche");
  assert.equal(spokenClock(10, 10), "las diez y 10 de la mañana");
  assert.equal(spokenClock(0, 0), "las doce de la noche");
  assert.equal(spokenClock(3, 0), "las tres de la madrugada");
});

test("la voz no lee símbolos ni comillas", () => {
  assert.equal(speechText("✓ Nota guardada. Ya está sincronizada."), "Nota guardada. Ya está sincronizada.");
  assert.equal(speechText("Ojo: a esa hora ya tienes «Dentista» a las 21:00. ¿Lo añado igual?"), "Ojo: a esa hora ya tienes Dentista a las nueve de la noche. ¿Lo añado igual?");
  assert.equal(speechText("«Pádel» mañana a las 13:00. Toca 📅 Añadir."), "Pádel mañana a la una del mediodía. Toca Añadir.");
  assert.equal(speechText("Llama al 600 123 456"), "Llama al 600 123 456", "los teléfonos no se tocan");
});

test("el modo conversación dice frases naturales y la voz pasa por el filtro", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(app, /const turn=speechTurn,spoken=speechText\(text\);/, "las dos voces reciben el texto ya preparado para hablar");
  assert.equal((app.match(/ui\.spokenModalText\(\)/g) || []).length, 4, "confirmaciones y resultados, en conversación y al dictar");
  assert.match(ui, /`¡Listo! Ya tienes \$\{eventPhrase\(note\)\} en tu agenda\.`/);
  assert.match(ui, /Te apunto \$\{eventPhrase\(note\)\} en la agenda\. ¿Te parece bien\?/);
});

test("frases cercanas: saludo al entrar, muletillas enteras y ofrecer seguir", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const list = name => JSON.parse(app.match(new RegExp(`const ${name}=(\\[[^\\]]*\\]);`))[1]);
  for (const phrase of list("CONVERSATION_FILLERS")) assert.ok(phrase.split(" ").length >= 3, `«${phrase}» es demasiado seca`);
  assert.ok(list("CONVERSATION_GREETINGS").length >= 3);
  assert.match(app, /await speakAloud\(hello\);\n if\(conversationOn\)startConversationRecognizer\(\);/, "saluda antes de escuchar");
  assert.ok(list("CONVERSATION_FOLLOWUPS").includes(" ¿Algo más?"));
});
