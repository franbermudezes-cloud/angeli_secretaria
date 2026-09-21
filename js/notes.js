// Preparación local de la ficha; no cambia el contrato de almacenamiento.
export function prepareNoteDraft(entry, settings = {}) {
  const intent = entry.aiIntent || {};
  const original = clean(entry.text);
  const stripCommand = value => {
    let text = clean(value).replace(/^\s*(?:(?:añade|añadir|anota|apunta|guarda|guardar|crea|crear)(?:me)?|(?:quiero|necesito)\s+(?:crear|añadir|guardar)?)\s+(?:una\s+)?nota\b\s*/i, "");
    if (text !== clean(value)) {
      for (const category of settings.categories || []) {
        const label = category.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`^(?:en\\s+(?:la\\s+categor[ií]a\\s+)?)?${label}(?=\\s|[,:.]|$)`, "i"), "").trim();
      }
      text = text.replace(/^[,:.]*\s*(?:(?:en\s+la\s+que|que\s+(?:diga|dice)|con\s+(?:el\s+)?(?:contenido|texto))\s*:?\s*|(?:sobre|de|para)\s+)?/i, "").trim();
    }
    return text;
  };
  const text = stripCommand(intent.notes || original);
  const candidate = clean(intent.title);
  // Una repetición de la orden no es un título interpretado. Pedimos uno
  // explícito en vez de inventar un resumen o recortar información al azar.
  const title = candidate && !/^nota[.!]*$/i.test(candidate) && candidate !== original && candidate !== text && stripCommand(candidate) === candidate ? candidate : "";
  return { ...entry, text, aiIntent: { ...intent, title, notes: text || null } };
}

export function missingNoteDraftFields(entry) {
  // El título ya NO es obligatorio: noteTitle() (más abajo) siempre cae al
  // texto de la nota o a "Nota" cuando no hay uno, igual que en las listas,
  // el Dietario y la biblioteca. Antes se exigía un título explícito, así
  // que casi cualquier nota corta dictada ("apunta comprar leche mañana")
  // —de la que prepareNoteDraft deliberadamente no inventa título— quedaba
  // bloqueada en la pantalla "Completar nota" hasta teclear uno a mano. Es
  // el mismo tipo de bloqueo innecesario que el "¿para qué guardas la foto?"
  // (V0.22.24): un campo obligatorio para algo que la app ya sabe rellenar
  // sola. Solo se sigue exigiendo el contenido (el texto): una nota sin nada
  // escrito no tiene nada que guardar.
  return [!clean(entry.text) && "text"].filter(Boolean);
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function normalizeNoteClassification(value = {}) {
  const scope = safeId(value?.scope, "general");
  const relationType = safeId(value?.relationType, "none");
  const relationName = relationType === "none" ? null : clean(value?.relationName);
  const tags = [...new Set((Array.isArray(value?.tags) ? value.tags : []).map(clean).filter(Boolean))].slice(0, 5);
  const categoryLabel = clean(value?.categoryLabel), relationTypeLabel = clean(value?.relationTypeLabel);
  return { scope, ...(categoryLabel ? { categoryLabel } : {}), relationType: relationName ? relationType : "none", ...(relationTypeLabel ? { relationTypeLabel } : {}), relationName, purpose: clean(value?.purpose), tags };
}

export function noteClassificationFromIntent(interpretation = {}) {
  return normalizeNoteClassification(interpretation.noteClassification);
}

export function updateNoteDraft(entry = {}, values = {}) {
  const title = clean(values.title) || noteTitle(entry);
  const text = clean(values.text) || clean(entry.text);
  const noteClassification = normalizeNoteClassification({
    scope: values.scope,
    categoryLabel: values.categoryLabel,
    relationType: values.relationType,
    relationTypeLabel: values.relationTypeLabel,
    relationName: values.relationName,
    purpose: values.purpose,
    tags: Array.isArray(values.tags) ? values.tags : String(values.tags || "").split(",")
  });
  return {
    ...entry,
    text,
    noteClassification,
    aiIntent: { ...(entry.aiIntent || {}), title, notes: text, noteClassification },
    updatedAt: new Date().toISOString()
  };
}

export function updateNoteStatus(entry = {}, status = "pending") {
  return { ...entry, status: status === "done" ? "done" : "pending", updatedAt: new Date().toISOString() };
}

export function removeNoteEntry(entries = [], id) {
  return entries.filter(entry => entry?.id !== id);
}

export function findNoteMatches(entries = [], interpretation = {}) {
  const query = normalized(interpretation.noteQuery || "");
  const requested = normalizeNoteClassification(interpretation.noteClassification);
  const status = ["pending", "done", "all"].includes(interpretation.noteStatus) ? interpretation.noteStatus : "pending";
  return entries
    .filter(entry => entry?.type === "note" && inRange(entry.date||entry.updatedAt,interpretation.rangeStart,interpretation.rangeEnd) && (status === "all" || (status === "done" ? entry.status === "done" : entry.status !== "done")))
    .map(entry => ({ entry, score: noteScore(entry, query, requested) }))
    .filter(result => result.score > 0 || (!query && isUnfiltered(requested)))
    .sort((left, right) => right.score - left.score || String(right.entry.date || "").localeCompare(String(left.entry.date || "")))
    .map(result => result.entry);
}

function inRange(value,start,end){if(!start&&!end)return true;const key=String(value||"").slice(0,10);return Boolean(key)&&(!start||key>=start)&&(!end||key<end)}

export function noteTitle(entry = {}) {
  return clean(entry.aiIntent?.title) || clean(entry.text) || "Nota";
}

export function noteClassificationLabel(value = {}) {
  const data = normalizeNoteClassification(value);
  const scope = data.categoryLabel || { general: "General", personal: "Personal", company: "Empresa" }[data.scope] || data.scope;
  const relation = data.relationName ? ` · ${data.relationName}` : "";
  return `${scope}${relation}`;
}

function noteScore(entry, query, requested) {
  const data = normalizeNoteClassification(entry.noteClassification || entry.aiIntent?.noteClassification);
  if (requested.scope !== "general" && data.scope !== requested.scope) return 0;
  if (requested.relationName && normalized(data.relationName) !== normalized(requested.relationName)) return 0;
  if (!query) return 1;
  const title = normalized(noteTitle(entry));
  const text = normalized(entry.text);
  const category = normalized(data.categoryLabel || data.scope);
  const relation = normalized(data.relationName);
  const purpose = normalized(data.purpose);
  const tags = data.tags.map(normalized);
  if (title === query || relation === query || category === query) return 8;
  if (title.includes(query) || relation.includes(query) || category.includes(query)) return 6;
  if (tags.some(tag => tag === query)) return 5;
  if (text.includes(query) || purpose.includes(query) || tags.some(tag => tag.includes(query))) return 3;
  return 0;
}

function isUnfiltered(value) {
  return value.scope === "general" && value.relationType === "none" && !value.purpose && !value.tags.length;
}

function normalized(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function safeId(value, fallback) { const id = clean(value); return SAFE_ID.test(id) ? id : fallback; }

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
