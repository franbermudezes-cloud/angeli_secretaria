import assert from "node:assert/strict";
import { chatAside } from "../js/ai.js";

// chatAside() es el lado cliente del módulo aparte (backend/app.py:
// /chat/aside): solo pide una reacción corta para el modo conversación,
// deliberadamente desacoplado del intérprete de órdenes (remoteProvider).
// Un fallo aquí nunca debe impedir hablar: app.js cae a su lista fija de
// coletillas si esta función lanza por cualquier motivo.

const originalFetch = globalThis.fetch;

async function withFetch(mockFetch, run) {
  globalThis.fetch = mockFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await withFetch(
  async (url, options) => {
    assert.equal(url, "https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app/chat/aside");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer token-123");
    assert.deepEqual(JSON.parse(options.body), { text: "apunta que compre leche" });
    return { ok: true, status: 200, json: async () => ({ reply: "¡Vale, voy!" }) };
  },
  async () => {
    const reply = await chatAside("apunta que compre leche", "token-123");
    assert.equal(reply, "¡Vale, voy!");
  }
);

// Sin token (no ha iniciado sesión, o aún no hay uno disponible): debe
// rechazar sin llegar a mandar la petición de red.
await assert.rejects(() => chatAside("algo", null), /IA sin conexión/);

await withFetch(
  async () => ({ ok: false, status: 503, json: async () => ({}) }),
  async () => {
    await assert.rejects(() => chatAside("algo", "token-123"), /Aside no disponible/);
  }
);

await withFetch(
  async () => ({ ok: true, status: 200, json: async () => ({ reply: "   " }) }),
  async () => {
    await assert.rejects(() => chatAside("algo", "token-123"), /Respuesta de aside vacía/);
  }
);

console.log("chat-aside: ok");
