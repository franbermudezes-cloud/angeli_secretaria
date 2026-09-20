import { normalizeNoteSettings, settingLabel } from "./note-settings.js?v=0.22.22";

// El valor por defecto de un parámetro solo actúa sobre "undefined": si
// pendingMediaContext aún es null (antes de la primera clasificación), un
// "= {}" en la firma no lo sustituye y toda lectura de propiedad revienta.
export function normalizeMediaContext(value, settings) {
  value = value || {};
  const normalizedSettings = normalizeNoteSettings(settings);
  const scope = normalizedSettings.categories.some(option => option.id === value.scope)
    ? value.scope
    : normalizedSettings.categories[0].id;
  const relationType = normalizedSettings.relationTypes.some(option => option.id === value.relationType)
    ? value.relationType
    : "none";
  return {
    purpose: clean(value.purpose),
    scope,
    categoryLabel: settingLabel(normalizedSettings, "categories", scope),
    relationType,
    relationTypeLabel: relationType === "none" ? "" : settingLabel(normalizedSettings, "relationTypes", relationType),
    relationName: relationType === "none" ? "" : clean(value.relationName)
  };
}

export function mediaContextComplete(value) {
  if (!clean(value?.purpose)) return false;
  return !value?.relationType || value.relationType === "none" || Boolean(clean(value.relationName));
}

export function mediaContextRelation(value) {
  value = value || {};
  if (!clean(value.relationName)) return "";
  return [clean(value.relationTypeLabel), clean(value.relationName)].filter(Boolean).join(": ");
}

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
