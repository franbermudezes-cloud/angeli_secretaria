import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { confirmationReply } from "../js/conversation.js";

// «Sí» dicho en el modo conversación confirma igual que tocar el botón.
// Se ejecuta el código real de app.js con una pantalla simulada.
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const grab = name => app.match(new RegExp(`async function ${name}\\(([\\s\\S]*?)\\n\\}\\n`))[0];

function harness() {
  const log = [];
  const classes = new Set(["show"]);
  const modal = { classList: { contains: name => classes.has(name) } };
  const button = { isConnected: true, click() { log.push("click"); this.isConnected = false; } };
  const scope = {
    conversationConfirm: button, conversationBusy: false, conversationModalObserver: null,
    $: () => modal, confirmationReply,
    ui: { addConversationTurn: (who, text) => log.push(`${who}:${text}`), closeLayers: () => { log.push("close"); classes.delete("show"); }, notify: text => log.push(`toast:${text}`), setConversationStatus: () => {} },
    conversationHandleOutcome: async () => log.push("outcome")
  };
  const body = `${grab("conversationAnswerConfirm")}\n${grab("waitForConfirmResult")}\nreturn { run: conversationAnswerConfirm, state: () => ({ conversationConfirm, conversationBusy }) };`;
  const names = Object.keys(scope);
  const { run, state } = new Function(...names, `let ${names.map(n => `${n}_=${n}`).join(",")};` + body.replace(/\b(conversationConfirm|conversationBusy|conversationModalObserver)\b/g, "$1_"))(...names.map(n => scope[n]));
  return { run, state, log, button };
}

test("«sí» pulsa el botón de confirmar y luego cuenta el resultado", async () => {
  const h = harness();
  assert.equal(await h.run("Sí, por favor"), true);
  assert.deepEqual(h.log, ["me:Sí, por favor", "click", "outcome"]);
});

test("«no» cierra sin hacer nada", async () => {
  const h = harness();
  assert.equal(await h.run("no"), true);
  assert.deepEqual(h.log, ["me:no", "close", "toast:Vale, lo dejo", "outcome"]);
});

test("otra frase sigue su camino normal y no pulsa nada", async () => {
  const h = harness();
  assert.equal(await h.run("mejor a las diez"), false);
  assert.deepEqual(h.log, []);
});

test("solo crear evento o programar aviso se confirman por voz; borrar no", () => {
  assert.match(app, /const VOICE_CONFIRM_ACTIONS=new Set\(\["calendar","calendar-bundle","schedule"\]\)/);
  assert.match(app, /classList\.contains\("confirm"\)&&VOICE_CONFIRM_ACTIONS\.has\(primaryButton\.dataset\.a\)/);
  assert.match(app, /async function conversationRunTurn\(text\)\{\n if\(await conversationAnswerConfirm\(text\)\)return;/);
});
