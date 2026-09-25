// Prepara WhatsApp Click to Chat. La persona confirma el envío dentro de WhatsApp.
export function whatsappPhone(value = "") {
  const raw = String(value).trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!raw.startsWith("+") && !raw.startsWith("00") && /^[6789]\d{8}$/.test(digits)) digits = "34" + digits;
  else if (!raw.startsWith("+") && !raw.startsWith("00")) return null;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function whatsappUrl(phone, message = "") {
  const number = whatsappPhone(phone);
  if (!number) throw new Error("Indica el teléfono con prefijo internacional, por ejemplo +34.");
  const text = String(message || "").trim();
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function whatsappChoices(note, result) {
  if (note.phone) return [{ name: note.contactQuery || "Número indicado", phone: note.phone }];
  const seen = new Set();
  return (result?.contacts || []).flatMap(contact => (contact.phones || []).map(phone => ({ name: contact.name, phone }))).filter(item => {
    const key = `${item.name}|${whatsappPhone(item.phone) || item.phone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Respaldo seguro y conversacional cuando la IA no está disponible.
export function localWhatsApp(text = "", active = null) {
  const value = String(text || "").trim();
  const prior = active?.aiIntent;
  if (prior?.intent === "whatsapp.compose" && active.interaction?.status === "awaiting_input") {
    const field = active.interaction.missingFields?.[0];
    // 3ª auditoría: `prior` es el aiIntent guardado y arrastraba `source` y
    // `fallbackReason`; validateIntent los rechaza («Campo IA no permitido») y,
    // con la IA caída o sin cupo, la respuesta al WhatsApp pendiente reventaba.
    const { source, fallbackReason, ...priorFields } = prior;
    if (["contactName", "notes"].includes(field)) return { ...priorFields, confidence: typeof priorFields.confidence === "number" ? priorFields.confidence : .5, [field]: value || null, missingFields: [], question: null };
  }
  const match = value.match(/^(?:(?:env[ií]a(?:le|me)?|m[aá]nda(?:le|me)?|escr[ií]be(?:le|me)?|enviar|mandar)\s+)?(?:(?:un\s+)?mensaje\s+(?:por|de)\s+)?(?:un\s+)?whats?app(?:\s+(?:a|al|para)\s+(.+))?[.!?]*$/i);
  if (!match) return null;
  // 3ª auditoría: sin «dile/diciéndole» el mensaje se comía al contacto
  // («a Ana que llego tarde» -> contacto «Ana que llego tarde»). Se separa
  // también por «y dile», «para decirle», una coma, o el primer «que» detrás de
  // un nombre corto (hasta 4 palabras).
  const rest = (match[1] || "").trim();
  let parts = rest.split(/\s+(?:y\s+)?(?:dici[eé]ndo(?:le)?|dile|para\s+decirle|con el (?:texto|mensaje)|que diga)\s*:?\s*|\s*[:,]\s*/, 2);
  if (parts.length < 2) {
    const short = rest.match(/^((?:\S+\s+){0,3}?\S+)\s+que\s+(.+)$/i);
    if (short && !/^(?:el|la|los|las|un|una)$/i.test(short[1])) parts = [short[1], short[2]];
  }
  const contact = parts[0]?.trim() || null;
  const phone = contact && /^[+\d\s().-]{9,}$/.test(contact) ? contact.replace(/[^\d+]/g, "") : null;
  return { intent: "whatsapp.compose", confidence: .5, title: null, date: null, time: null,
    location: null, contactName: phone ? null : contact, phone, notes: parts[1]?.trim() || null,
    target: null, changes: null, missingFields: [], question: null, requiresConfirmation: true };
}
