import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { entriesToReschedule, runInBatches } from "../js/notification-settings.js";

// Reportado por el propietario: al guardar los ajustes de avisos la pantalla no
// se cerraba; pulsó varias veces y el servidor recibió 40 peticiones en un
// minuto (20 rechazadas por el límite de 30/min).
const now = new Date(2026, 8, 26, 12);

test("solo se reprograma lo que todavía puede sonar", () => {
  const entries = [
    { id: "futuro", schedule: { status: "scheduled", dueAt: "2026-09-27T10:00:00" } },
    { id: "ayer-tarde", schedule: { status: "scheduled", dueAt: "2026-09-25T20:00:00" } },
    { id: "hace-un-mes", schedule: { status: "scheduled", dueAt: "2026-08-20T10:00:00" } },
    { id: "evento", type: "calendar", calendarStatus: "synced", scheduledDate: "2026-10-01", scheduledTime: "21:00" },
    { id: "tarea", type: "task", status: "pending", scheduledDate: "2026-09-30", scheduledTime: "09:00" },
    { id: "tarea-hecha", type: "task", status: "done", scheduledDate: "2026-09-30", scheduledTime: "09:00" },
    { id: "nota", type: "note" }
  ];
  assert.deepEqual(entriesToReschedule(entries, now).map(entry => entry.id), ["futuro", "ayer-tarde", "evento", "tarea"]);
});

test("se programan de pocos en pocos, nunca todos a la vez", async () => {
  let running = 0, peak = 0;
  const failed = await runInBatches([1, 2, 3, 4, 5, 6, 7], async item => {
    running++; peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--;
    if (item === 4) throw new Error("fallo");
  }, 3);
  assert.equal(peak, 3);
  assert.equal(failed, 1);
});

test("el botón no se puede pulsar dos veces mientras guarda", () => {
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /label:"Guardar ajustes",kind:"confirm",onClick:async event=>\{const button=event\.currentTarget;if\(button\.disabled\)return;button\.disabled=true;button\.textContent="Guardando…"/);
});
