const SCOPES = new Set(["general", "personal", "company"]);
const RELATION_TYPES = new Set(["none", "person", "client", "project", "event"]);

export function normalizeNoteClassification(value = {}) {
  const scope = SCOPES.has(value?.scope) ? value.scope : "general";
  const relationType = RELATION_TYPES.has(value?.relationType) ? value.relationType : "none";
  const relationName = relationType === "none" ? null : clean(value?.relationName);
  const tags = [...new Set((Array.isArray(value?.tags) ? value.tags : []).map(clean).filter(Boolean))].slice(0, 5);
  return { scope, relationType: relationName ? relationType : "none", relationName, purpose: clean(value?.purpose), tags };
}

export function noteClassificationFromIntent(interpretation = {}) {
  return normalizeNoteClassification(interpretation.noteClassification);
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
  const scope = { general: "General", personal: "Personal", company: "Empresa" }[data.scope];
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
  const relation = normalized(data.relationName);
  const purpose = normalized(data.purpose);
  const tags = data.tags.map(normalized);
  if (title === query || relation === query) return 8;
  if (title.includes(query) || relation.includes(query)) return 6;
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

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
