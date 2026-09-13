/** Índice derivado de los adjuntos guardados en las entradas de Firestore. */
export function mediaLibraryItems(entries = []) {
  return entries.flatMap(entry => {
    const typeLabel = ({ note: "Notas", task: "Tareas", reminder: "Recordatorios", calendar: "Calendario", contact: "Contactos", photo: "Fotos", file: "Archivos" })[entry.type] || "Otros";
    const context = entry.mediaContext || {}, classification = entry.noteClassification || {};
    // Entradas antiguas llegaron a guardar literalmente "none" como
    // relationTypeLabel (el identificador de "sin relación", no una
    // etiqueta real). Se descarta explícitamente para que ese texto de
    // depuración no se cuele en la interfaz como si fuera una relación real.
    const relation = [context.relationTypeLabel || classification.relationTypeLabel, context.relationName || classification.relationName]
      .filter(part => Boolean(part) && part !== "none")
      .join(": ");
    const common = {
      entryId: entry.id,
      entryText: context.purpose || classification.purpose || entry.text || "Entrada con adjunto",
      purpose: context.purpose || classification.purpose || "",
      relation,
      entryType: entry.type || "note",
      status: entry.status || "pending",
      date: entry.updatedAt || entry.date || "",
      category: context.scope || entry.noteClassification?.scope || entry.type || "other",
      categoryLabel: context.categoryLabel || entry.noteClassification?.categoryLabel || typeLabel
    };
    const mapItem = (item, kind, index) => {
      const data = typeof item === "string" ? { id: item } : (item || {});
      const driveId = data.driveFileId || data.id || item;
      return {
        ...common,
        key: `${entry.id}:${kind}:${driveId || index}`,
        driveId,
        kind,
        name: data.name || (kind === "image" ? `Foto ${index + 1}` : `Archivo ${index + 1}`),
        mimeType: data.type || (kind === "image" ? "image/*" : "application/octet-stream"),
        size: Number(data.size) || 0,
        webViewLink: data.webViewLink || data.url || ""
      };
    };
    return [
      ...(entry.images || []).map((item, index) => mapItem(item, "image", index)),
      ...(entry.files || []).map((item, index) => mapItem(item, "file", index))
    ];
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function filterMediaLibrary(items, { kind = "all", category = "all", query = "" } = {}) {
  const needle = query.trim().toLocaleLowerCase("es");
  return items.filter(item => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (category !== "all" && item.category !== category) return false;
    return !needle || [item.name, item.entryText, item.categoryLabel, item.relation, item.mimeType]
      .filter(Boolean).join(" ").toLocaleLowerCase("es").includes(needle);
  });
}

export function mediaSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
