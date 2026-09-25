import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dayBriefing } from "../js/agenda.js";

// Resumen del día: la primera vez que se abre Angeli cada día.
const morning = new Date(2026, 8, 26, 8, 30), evening = new Date(2026, 8, 26, 18);
const at = (summary, time, extra = {}) => ({ summary, start: `2026-09-26T${time}:00+02:00`, allDay: false, ...extra });

test("saluda según la hora y cuenta lo que hay", () => {
  assert.equal(dayBriefing([], morning), "Buenos días. Hoy no tienes nada en la agenda.");
  assert.equal(dayBriefing([], evening), "Buenas tardes. No te queda nada más en la agenda por hoy.");
  assert.equal(dayBriefing([at("Dentista", "17:00")], morning), "Buenos días. Hoy tienes «Dentista» a las 17:00.");
  assert.equal(dayBriefing([{ summary: "Cumpleaños de Ana", start: "2026-09-26", allDay: true }, at("Cena con Marta", "21:00")], evening),
    "Buenas tardes. Lo que queda de hoy tienes 2 cosas: «Cumpleaños de Ana» todo el día y «Cena con Marta» a las 21:00.");
});

test("el aviso de un evento no se cuenta dos veces y una agenda llena se resume", () => {
  assert.equal(dayBriefing([at("Dentista", "17:00", { id: "angeliabc" }), at("Llevar la tarjeta", "16:30", { relatedEventId: "angeliabc" })], morning), "Buenos días. Hoy tienes «Dentista» a las 17:00.");
  const busy = ["9:00", "10:00", "11:00", "12:00", "13:00"].map((time, index) => at(`Cita ${index + 1}`, time.padStart(5, "0")));
  assert.equal(dayBriefing(busy, morning), "Buenos días. Hoy tienes 5 cosas. La primera, «Cita 1» a las 09:00.");
});

test("se muestra una vez al día, al abrir o al volver a la app", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /readDayBriefingShown\(\)===today/);
  assert.match(app, /onAuthChange:[^}]*void maybeDayBriefing\(\)/);
  assert.match(app, /visibilitychange[^\n]*maybeDayBriefing/);
});
