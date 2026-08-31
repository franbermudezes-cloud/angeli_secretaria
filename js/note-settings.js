export const DEFAULT_NOTE_SETTINGS = Object.freeze({
  categories: [
    { id: "general", label: "General" },
    { id: "personal", label: "Personal" },
    { id: "company", label: "Empresa" }
  ],
  relationTypes: [
    { id: "person", label: "Persona" },
    { id: "client", label: "Cliente" },
    { id: "project", label: "Proyecto" },
    { id: "event", label: "Evento" }
  ]
});

export function normalizeNoteSettings(value = {}) {
  const categories = normalizeOptions(value.categories, DEFAULT_NOTE_SETTINGS.categories);
  const relationTypes = normalizeOptions(value.relationTypes, DEFAULT_NOTE_SETTINGS.relationTypes);
  return { categories: categories.length ? categories : [...DEFAULT_NOTE_SETTINGS.categories], relationTypes };
}

export function addNoteSetting(settings, key, label) {
  const current = normalizeNoteSettings(settings);
  const cleanLabel = clean(label);
  if (!cleanLabel) return current;
  const options = current[key] || [];
  let id = slug(cleanLabel) || `option-${Date.now()}`;
  let suffix = 2;
  while (options.some(option => option.id === id)) id = `${slug(cleanLabel)}-${suffix++}`;
  return normalizeNoteSettings({ ...current, [key]: [...options, { id, label: cleanLabel }] });
}

export function renameNoteSetting(settings, key, id, label) {
  const current = normalizeNoteSettings(settings);
  const cleanLabel = clean(label);
  if (!cleanLabel) return current;
  return normalizeNoteSettings({ ...current, [key]: (current[key] || []).map(option => option.id === id ? { ...option, label: cleanLabel } : option) });
}

export function removeNoteSetting(settings, key, id) {
  const current = normalizeNoteSettings(settings);
  const remaining = (current[key] || []).filter(option => option.id !== id);
  if (key === "categories" && !remaining.length) return current;
  return normalizeNoteSettings({ ...current, [key]: remaining });
}

export function settingLabel(settings, key, id, fallback = "") {
  return normalizeNoteSettings(settings)[key]?.find(option => option.id === id)?.label || clean(fallback) || clean(id);
}

export function noteInterpretationContext(activeContext, settings) {
  return { ...(activeContext || {}), noteSettings: normalizeNoteSettings(settings) };
}

export function applyExplicitNoteCategory(interpretation, text, settings) {
  if (interpretation?.intent !== "note" || explicitlyRelates(text)) return interpretation;
  const category = explicitCategory(text, normalizeNoteSettings(settings).categories);
  if (!category) return interpretation;
  const current = interpretation.noteClassification || {};
  const duplicatedRelation = normalized(current.relationName) === normalized(category.label);
  return {
    ...interpretation,
    noteClassification: {
      ...current,
      scope: category.id,
      categoryLabel: category.label,
      ...(duplicatedRelation ? { relationType: "none", relationName: null } : {})
    }
  };
}

function normalizeOptions(values, fallback) {
  if (!Array.isArray(values)) return [...fallback];
  const found = new Set();
  return values.map(option => ({ id: clean(option?.id), label: clean(option?.label) })).filter(option => option.id && option.label && !found.has(option.id) && found.add(option.id)).slice(0, 30);
}

function slug(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function explicitCategory(text, categories) {
  const value = normalized(text);
  return categories.find(category => {
    const label = escapeRegex(normalized(category.label));
    return new RegExp(`\\b(?:anota|apunta|guarda)(?:\\s+(?:esto|una\\s+nota))?\\s+en\\s+(?:la\\s+categoria\\s+)?${label}(?:\\b|$)`, "i").test(value);
  });
}

function explicitlyRelates(text) {
  return /\b(?:relaciona|vincula|asocia)(?:r|da)?\b|\brelacionad[ao]\s+con\b/i.test(normalized(text));
}

function normalized(value) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
