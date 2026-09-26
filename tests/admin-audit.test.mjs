import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 3ª auditoría (regresiones de V0.23.0, multiusuario).
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../js/app.js"), ui = read("../js/ui.js"), firebase = read("../js/firebase.js"), rules = read("../firestore.rules");

test("un fallo de red al comprobar el acceso ya no cierra la sesión del invitado", () => {
  const gate = firebase.match(/try \{\n\s+decision = await fetchAccessStatus\(nextUser\);\n\s+\} catch \(error\) \{[\s\S]*?\n\s+\}/)?.[0] || "";
  assert.ok(gate, "debe existir la comprobación de acceso");
  assert.doesNotMatch(gate, /signOut\(auth\)/, "solo un «no» explícito del servidor cierra la sesión");
  assert.match(gate, /decision = \{ allowed: true, owner: false, mode: "unknown"/);
  assert.match(firebase, /if \(!decision\?\.allowed\) \{[\s\S]*?await signOut\(auth\);/, "un «no» explícito sigue cerrando la sesión");
  assert.doesNotMatch(firebase, /notify\("[^"]*conectad[ao]/, "los mensajes al usuario van en lenguaje neutro");
});

test("el panel de administración no se reabre solo encima de otra pantalla y vuelve a la lista tras cada acción", () => {
  assert.match(app, /const panelVisible=\(\)=>\$\("actionModal"\)\.classList\.contains\("show"\)&&Boolean\(\$\("modalBody"\)\.querySelector\("\.admin-panel"\)\);/);
  assert.match(app, /if\(!force&&shown&&!\$\("actionModal"\)\.classList\.contains\("show"\)\)\{stopAdmin\(\);return\}if\(!force&&shown&&!panelVisible\(\)\)return;/);
  assert.equal((app.match(/render\(true\)/g) || []).length, 5, "invitar, grifo, cortar/reactivar, tope y quitar vuelven a la lista");
});

test("invitar a alguien que ya está no lo reactiva ni le cambia el modo en silencio", () => {
  assert.match(app, /onInvite:email=>\{const existing=people\.find\(person=>person\.email===email\);if\(existing\)\{ui\.notify\(/);
});

test("un tope vacío se muestra como el tope por defecto (40), igual que lo cuenta el servidor", () => {
  assert.match(app, /person\.monthlyLimit!==null&&person\.monthlyLimit!==undefined&&person\.monthlyLimit!==""&&Number\.isFinite\(Number\(person\.monthlyLimit\)\)\?Number\(person\.monthlyLimit\):ADMIN_DEFAULT_LIMIT/);
});

test("los títulos del panel no se escapan dos veces (se ponen como texto, no HTML)", () => {
  const panel = ui.slice(ui.indexOf("function showAdminPanel("), ui.indexOf("Reportado en la 2ª auditoría: crear un acceso directo"));
  assert.match(panel, /openModal\(\{ title: person\.name \|\| person\.email, lead: person\.email, actions \}\);/);
  assert.doesNotMatch(panel, /openModal\(\{[^}]*esc\(/, "openModal pone título y texto como texto: esc() ahí escapaba dos veces");
  assert.doesNotMatch(panel, /lead: `[^`]*esc\(/, "tampoco en los textos de las preguntas");
});

test("la colección access exige además el correo verificado", () => {
  assert.match(rules, /request\.auth\.token\.email == "franbermudez\.es@gmail\.com" && request\.auth\.token\.email_verified == true/);
});

// PRIVACIDAD: cada persona conecta SU Google. Una persona invitada ve los
// botones de Calendar, Contactos y Drive y un aviso de que son los suyos; el
// servidor usa sus propias llaves (backend/test_access_control.py,
// GooglePerPersonTests).
test("una persona invitada conecta su propio Google", () => {
  assert.match(app, /function refreshOwnerUI\(\)\{const session=cloud\.session\(\),owner=Boolean\(session\.owner\),guest=session\.signedIn&&!owner;/);
  assert.doesNotMatch(app, /row\.hidden=guest/, "ya no se esconden sus botones de Conectar");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="guestIntegrationsNote" class="menu-copy" hidden>Conecta aquí tu propia cuenta de Google/);
});
