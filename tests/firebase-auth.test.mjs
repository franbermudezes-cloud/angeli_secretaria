import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const firebase = readFileSync(new URL("../js/firebase.js", import.meta.url), "utf8");

const onAuthStateChangedSource = firebase.match(/onAuthStateChanged\(auth, async nextUser => \{[\s\S]*?\n    \}\);/)?.[0] || "";
assert.ok(onAuthStateChangedSource, "el callback de onAuthStateChanged debe existir");

// Real encontrado en auditoría de código: "nextUser?.email?.toLowerCase() !==
// OWNER_EMAIL" como única condición también es verdadera cuando nextUser es
// null (undefined !== OWNER_EMAIL) — es decir, tanto cerrar sesión como cargar
// la app sin sesión previa entraban en la rama de "cuenta equivocada", donde
// nextUser falso hacía que no se hiciera nada y la función saliera con "return"
// sin limpiar `user`, sin desuscribir los 5 listeners de Firestore y sin avisar
// a la UI — la app se quedaba mostrando sesión iniciada indefinidamente.
//
// Multiusuario (V0.23.0): el candado dejó de ser "solo el propietario" y pasó a
// "propietario o invitado" (el servidor decide). El guard de nextUser nulo se
// trata ahora de forma explícita y ANTES que nada, que es la forma más directa
// de conservar aquel arreglo: un usuario nulo limpia y sale por el flujo de
// desconexión, nunca por el de una cuenta identificada.
assert.match(
  onAuthStateChangedSource,
  /if \(!nextUser\) \{/,
  "un nextUser nulo debe tratarse explícitamente primero (cerrar sesión / arranque sin sesión)"
);
const nullBranch = onAuthStateChangedSource.slice(onAuthStateChangedSource.indexOf("if (!nextUser)"));
assert.match(nullBranch, /user = null;/, "el guard nulo debe limpiar `user`");
assert.match(nullBranch, /stopListening\(\);/, "el guard nulo debe desuscribir los listeners de Firestore");
assert.match(nullBranch, /callbacks\.onAuthChange\?\.\(session\(\)\);/, "el guard nulo debe avisar a la UI");

// La condición vieja (una sola comparación de email sin comprobar antes que
// nextUser existe) era la causa del cierre de sesión roto: no debe volver.
assert.doesNotMatch(
  onAuthStateChangedSource,
  /if \(nextUser\?\.email\?\.toLowerCase\(\) !== OWNER_EMAIL\) \{/,
  "no debe volver la condición vieja que confundía un usuario nulo con una cuenta equivocada"
);

// El propietario entra directo, sin consultar al servidor; cualquier otra
// cuenta se valida contra /access/status y se cierra sesión si no tiene acceso.
assert.match(onAuthStateChangedSource, /email === OWNER_EMAIL/, "el propietario entra por su propia rama");
assert.match(onAuthStateChangedSource, /fetchAccessStatus\(nextUser\)/, "una cuenta no propietaria debe validarse contra el servidor");
assert.match(onAuthStateChangedSource, /if \(!decision\?\.allowed\) \{[\s\S]*?signOut\(auth\)/, "sin acceso concedido debe cerrarse la sesión");

// El estado de acceso se pregunta al endpoint del servidor, que es la autoridad.
assert.match(firebase, /\/access\/status/, "debe existir la llamada a /access/status");
// Las invitaciones se administran sobre la colección `access`.
assert.match(firebase, /collection\(db, "access"\)/, "el panel administra la colección access");

console.log("firebase-auth: ok");
