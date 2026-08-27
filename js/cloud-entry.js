const SYNCABLE_FIELDS = new Set([
  "id", "date", "updatedAt", "text", "status", "type", "scheduledDate",
  "scheduledTime", "phone", "location", "calendarTitle", "calendarDescription",
  "contactQuery", "calendarStatus", "calendarEventId", "calendarUrl", "aiIntent",
  "proposal", "schedule", "images", "files", "interaction"
]);

export function toCloudEntry(note, updatedAt = new Date().toISOString()) {
  const result = {};
  for (const [key, value] of Object.entries(note || {})) {
    if (SYNCABLE_FIELDS.has(key) && value !== undefined) result[key] = removeUndefined(value);
  }
  result.updatedAt = updatedAt;
  return result;
}

export function fromCloudEntry(value, id) {
  return { ...removeUndefined(value || {}), id };
}

export function sameEntry(left, right) {
  const clean = value => { const copy = removeUndefined(value || {}); delete copy.updatedAt; return copy; };
  return JSON.stringify(clean(left)) === JSON.stringify(clean(right));
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, removeUndefined(item)]));
  return value;
}
