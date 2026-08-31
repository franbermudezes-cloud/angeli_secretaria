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
    aiIntent: { ...(entry.aiIntent || {}), title, noteClassification },
    updatedAt: new Date().toISOString()
  };
}

export function findNoteMatches(entries = [], interpretation = {}) {
  const query = normalized(interpretation.noteQuery || "");
  const requested = normalizeNoteClassification(interpretation.noteClassification);
  return entries
    .filter(entry => entry?.type === "note" && entry?.status !== "done")
    .map(entry => ({ entry, score: noteScore(entry, query, requested) }))
    .filter(result => result.score > 0 || (!query && isUnfiltered(requested)))
    .sort((left, right) => right.score - left.score || String(right.entry.date || "").localeCompare(String(left.entry.date || "")))
    .map(result => result.entry);
}

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
