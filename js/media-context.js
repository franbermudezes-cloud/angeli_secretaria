import { normalizeNoteSettings, settingLabel } from "./note-settings.js?v=0.23.0";

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

// Real reportado por el propietario: subir una foto sin más ("porque quiero
// subirla, ya está") quedaba bloqueado del todo si no se explicaba primero
// "¿para qué lo guardas?" — no había forma de saltarlo. El motivo siempre ha
// sido opcional en el resto de la app (media-library.js ya cae a "Entrada
// con adjunto" cuando no hay ninguno), así que exigirlo aquí era una regla
// más estricta que en cualquier otro sitio, sin ninguna necesidad real. Solo
// se sigue exigiendo el nombre de la relación cuando se elige explícitamente
// un tipo de relación — dejarlo en blanco ahí sí sería un dato sin sentido
// ("relacionado con: persona ‹en blanco›").
export function mediaContextComplete(value) {
  return !value?.relationType || value.relationType === "none" || Boolean(clean(value.relationName));
}

export function mediaContextRelation(value) {
  value = value || {};
  if (!clean(value.relationName)) return "";
  return [clean(value.relationTypeLabel), clean(value.relationName)].filter(Boolean).join(": ");
}

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
