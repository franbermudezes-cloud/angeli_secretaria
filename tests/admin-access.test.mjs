import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
const ai = readFileSync(new URL("../js/ai.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

// El panel vive en Ajustes, oculto por defecto (solo el propietario lo ve).
assert.match(html, /id="adminSection" hidden/, "la sección de administración arranca oculta");
assert.match(html, /id="adminPanelOpen"/, "debe existir el botón para abrir el panel");

// Solo se revela cuando la sesión dice que es el propietario.
assert.match(app, /function refreshOwnerUI\(\)\{[\s\S]*?\$\("adminSection"\)\.hidden=!owner/, "adminSection se muestra solo al propietario");
assert.match(app, /\$\("adminPanelOpen"\)\.onclick=\(\)=>\{ui\.closeLayers\(\);openAdminPanel\(\)\}/, "el botón cierra el menú y abre el panel");

// El menú (drawer, z-index 7) tapa el modal (z-index 6): abrir el panel debe
// cerrar el menú antes, o el modal quedaría detrás y no se vería.
assert.match(app, /ui\.closeLayers\(\);openAdminPanel\(\)/, "abrir el panel cierra antes el menú para que el modal quede visible");

// La UI del panel existe y está exportada.
assert.match(ui, /function showAdminPanel\(\{ people = \[\]/, "showAdminPanel debe existir");
assert.match(ui, /showAdminPanel, showMediaViewer/, "showAdminPanel debe estar exportada");
// Los tres estados que el propietario controla.
assert.match(ui, /🚰 Abrir el grifo/, "opción de grifo abierto");
assert.match(ui, /🚫 Cortar el acceso/, "opción de cortar");
assert.match(ui, /✏️ Cambiar tope mensual/, "opción de cambiar tope");
// El botón de opciones NO debe llevar la clase `subtle`, que está oculta por CSS.
assert.doesNotMatch(ui, /class="small-btn subtle" data-admin-index/, "el botón de opciones no puede ir oculto por la clase subtle");

// El periodo del cliente (año-mes UTC) debe replicar el del servidor para que el
// gasto mostrado y el reinicio mensual coincidan.
assert.match(app, /function adminPeriod\(\)\{const d=new Date\(\);return`\$\{d\.getUTCFullYear\(\)\}-\$\{String\(d\.getUTCMonth\(\)\+1\)\.padStart\(2,"0"\)\}`\}/, "el periodo del panel es año-mes en UTC");
assert.match(app, /const ADMIN_DEFAULT_LIMIT=40/, "el tope por defecto del cliente es 40, como el servidor");

// El agotamiento del cupo se detecta y se avisa a la persona.
assert.match(ai, /error\?\.code==="quota_exhausted"[\s\S]*?return"quota_exhausted"/, "failureReason distingue el cupo agotado");
assert.match(app, /fallbackReason==="quota_exhausted"[\s\S]*?ui\.notify\(/, "se avisa cuando se agota la prueba");

// La colección `access` solo la toca el propietario; el servidor usa el SDK
// de administración y no pasa por estas reglas.
assert.match(rules, /match \/access\/\{emailId\} \{/, "debe haber reglas para la colección access");
assert.match(rules, /request\.auth\.token\.email == "franbermudez\.es@gmail\.com"/, "solo el propietario lee o escribe access");

console.log("admin-access: ok");
