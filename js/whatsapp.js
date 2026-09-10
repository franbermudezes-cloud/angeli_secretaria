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
    if (["contactName", "notes"].includes(field)) return { ...prior, [field]: value || null, missingFields: [], question: null };
  }
  const match = value.match(/^(?:(?:env[ií]a(?:me)?|manda(?:me)?|escribe(?:me)?|enviar|mandar)\s+)?(?:(?:un\s+)?mensaje\s+(?:por|de)\s+)?(?:un\s+)?whats?app(?:\s+(?:a|para)\s+(.+))?[.!?]*$/i);
  if (!match) return null;
  const parts = (match[1] || "").split(/\s+(?:dici[eé]ndo(?:le)?|dile|con el (?:texto|mensaje)|que diga)\s*:?\s*|\s*:\s*/, 2);
  return { intent: "whatsapp.compose", confidence: .5, title: null, date: null, time: null,
    location: null, contactName: parts[0]?.trim() || null, phone: null, notes: parts[1]?.trim() || null,
    target: null, changes: null, missingFields: [], question: null, requiresConfirmation: true };
}
