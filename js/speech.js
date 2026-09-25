// Cómo suena Angeli en voz alta. Lo escrito en pantalla se queda igual
// («21:00», «📅 Añadir»); esto solo prepara el texto para la voz del móvil,
// que leía los símbolos («marca de verificación», «calendario») y las horas
// como un reloj digital («veintiuno cero cero»). Ahora dice «a las nueve de
// la noche», como lo diría una persona.

const HOURS = ["doce", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once"];

function dayPart(hour) {
  if (hour >= 6 && hour < 12) return "de la mañana";
  if (hour >= 12 && hour < 14) return "del mediodía";
  if (hour >= 14 && hour < 21) return "de la tarde";
  if (hour >= 1 && hour < 6) return "de la madrugada";
  return "de la noche";
}

// «17:30» -> «las cinco y media de la tarde»; «13:00» -> «la una del mediodía».
export function spokenClock(hour, minute) {
  let h = Number(hour), m = Number(minute);
  let tail = "";
  if (m === 15) tail = " y cuarto";
  else if (m === 30) tail = " y media";
  else if (m === 45) { tail = " menos cuarto"; h = (h + 1) % 24; }
  else if (m) tail = ` y ${m}`;
  const name = HOURS[h % 12];
  const part = h === 0 && !m ? "de la noche" : dayPart(h);
  return `${name === "una" ? "la" : "las"} ${name}${tail} ${part}`;
}

export function speechText(text = "") {
  return String(text || "")
    // «a las 13:00» -> «a la una del mediodía»; «las 21:00» y «21:00» sueltos también.
    .replace(/\b(?:(a|de|hasta)\s+)?(?:las?\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/gi, (_, prep, h, m) => `${prep ? `${prep} ` : ""}${spokenClock(h, m)}`)
    .replace(/[\p{Extended_Pictographic}\u2713\u2714\u270E\uFE0F\u200D\u20E3]/gu, "")
    .replace(/[«»"“”]/g, "")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])\s*\.+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
