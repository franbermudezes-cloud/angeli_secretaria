/** Medios remotos de Angeli: Drive es la única copia permanente. */
const API = "https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app";
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export function createMediaService({ getAuthToken, ensureDrive }) {
  async function upload(file, kind, entryId) {
    if (!(file instanceof Blob)) throw new Error("Archivo no válido");
    if (file.size > MAX_MEDIA_BYTES) throw new Error("El archivo supera el límite de 20 MB");
    if (!(await ensureDrive())) throw new Error("Drive no está conectado");
    const response = await fetch(API + "/media/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getAuthToken()}`,
        "Content-Type": "application/octet-stream",
        "X-Angeli-Name": encodeURIComponent(file.name || (kind === "image" ? "foto" : "archivo")),
        "X-Angeli-Type": file.type || "application/octet-stream",
        "X-Angeli-Kind": kind,
        "X-Angeli-Entry": entryId
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo subir el archivo a Drive");
    return data;
  }

  async function getMedia(id) {
    const response = await request("/media/download", { fileId: id });
    if (!response.ok) throw new Error("No se pudo recuperar el archivo");
    return { blob: await response.blob(), type: response.headers.get("Content-Type") || "application/octet-stream" };
  }

  async function remove(id) {
    if (!id) return;
    const response = await request("/media/delete", { fileId: id });
    if (!response.ok) throw new Error("No se pudo eliminar el archivo de Drive");
  }

  async function request(path, body) {
    return fetch(API + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getAuthToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  return { upload, getMedia, remove };
}
