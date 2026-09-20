import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const firebase = readFileSync(new URL("../js/firebase.js", import.meta.url), "utf8");

// Real encontrado en auditoría de código: "nextUser?.email?.toLowerCase() !==
// OWNER_EMAIL" como única condición también es verdadera cuando nextUser es
// null (undefined !== OWNER_EMAIL) — es decir, tanto cerrar sesión como
// cargar la app sin ninguna sesión previa entraban en la rama de "cuenta
// equivocada", donde nextUser falso hacía que no se hiciera nada y la
// función saliera con "return" sin limpiar `user`, sin desuscribir ninguno
// de los 5 listeners de Firestore (entries/settings/notifications/shopping/
// shortcuts) y sin avisar nunca a la UI (onAuthChange/onSyncStatus) — la app
// se quedaba mostrando el estado de sesión iniciada indefinidamente.
const onAuthStateChangedSource = firebase.match(/onAuthStateChanged\(auth, async nextUser => \{[\s\S]*?\n    \}\);/)?.[0] || "";
assert.ok(onAuthStateChangedSource, "el callback de onAuthStateChanged debe existir");
assert.match(
  onAuthStateChangedSource,
  /if \(nextUser && nextUser\.email\?\.toLowerCase\(\) !== OWNER_EMAIL\) \{/,
  "solo debe tratarse como \"cuenta equivocada\" cuando de verdad hay una cuenta distinta — un nextUser nulo (cerrar sesión) debe caer al flujo normal, no a este bloque"
);
assert.doesNotMatch(
  onAuthStateChangedSource,
  /if \(nextUser\?\.email\?\.toLowerCase\(\) !== OWNER_EMAIL\) \{/,
  "la condición vieja (sin comprobar que nextUser existe primero) es la causa real del cierre de sesión roto"
);
// Tras el guard de "cuenta equivocada", el flujo normal (user=nextUser||null,
// stopListening, onAuthChange) debe ser alcanzable para nextUser nulo — es
// decir, el guard debe terminar en "return" y el resto del código debe venir
// después en el mismo bloque, sin otro return de por medio antes de "user=".
const afterGuard = onAuthStateChangedSource.slice(onAuthStateChangedSource.indexOf("user = nextUser"));
assert.match(afterGuard, /^user = nextUser \|\| null;/, "tras el guard, el flujo normal debe ejecutarse siempre (incluido nextUser nulo)");
assert.match(onAuthStateChangedSource, /stopListening\(\);/);
assert.match(onAuthStateChangedSource, /callbacks\.onAuthChange\?\.\(session\(\)\);/);

console.log("firebase-auth: ok");
