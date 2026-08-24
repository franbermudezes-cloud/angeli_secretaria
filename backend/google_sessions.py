"""Autorizaciones persistentes de Google para el único propietario de Angeli.

Los refresh tokens nunca salen de Cloud Run: se guardan por integración en
Secret Manager y las llamadas a People/Calendar se realizan desde este módulo.
"""
from __future__ import annotations

import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CONTACTS = "contacts"
CALENDAR = "calendar"
DRIVE = "drive"
SCOPES = {
  CONTACTS: "openid email https://www.googleapis.com/auth/contacts.readonly",
  CALENDAR: "openid email https://www.googleapis.com/auth/calendar.events",
  # Solo los archivos que crea Angeli; no concede acceso a todo Mi unidad.
  DRIVE: "openid email https://www.googleapis.com/auth/drive.file",
}


class GoogleSessions:
    def __init__(self, project: str, client_id: str, grant_prefix: str = "angeli-google"):
        """Sesiones OAuth persistentes de un perfil de Angeli.

        ``angeli-google`` es siempre el perfil de producción. El arnés de
        pruebas usa explícitamente ``angeli-test-google`` para que una prueba
        no pueda leer, sustituir ni invalidar una autorización real.
        """
        if not grant_prefix or not grant_prefix.replace("-", "").isalnum():
            raise ValueError("Prefijo de autorizaciones no válido")
        self.project, self.client_id, self.grant_prefix = project, client_id, grant_prefix

    def _secret_name(self, integration: str) -> str:
        return f"{self.grant_prefix}-{integration}-grant"

    def _client(self):
        from google.cloud import secretmanager
        return secretmanager.SecretManagerServiceClient()

    def _read_secret(self, name: str) -> str | None:
        try:
            value = self._client().access_secret_version(
                request={"name": f"projects/{self.project}/secrets/{name}/versions/latest"}
            ).payload.data.decode("utf-8")
            return value or None
        except Exception as error:  # Secret without a version means disconnected.
            if type(error).__name__ in {"NotFound", "FailedPrecondition"}:
                return None
            raise

    def _write_secret(self, name: str, value: str) -> None:
        self._client().add_secret_version(
            request={"parent": f"projects/{self.project}/secrets/{name}", "payload": {"data": value.encode("utf-8")}}
        )

    def _oauth_secret(self) -> str:
        secret_name = (
            "angeli-test-google-oauth-client-secret"
            if self.grant_prefix == "angeli-test-google"
            else "angeli-oauth-client-secret"
        )
        value = self._read_secret(secret_name)
        if not value:
            raise RuntimeError("Falta el secreto OAuth del servidor")
        return value

    def connected(self, integration: str) -> bool:
        if integration == DRIVE:
            # Las carpetas por sí solas no bastan: una cuenta de servicio no
            # tiene cuota de Drive. Los adjuntos deben crearse con el Gmail
            # que autorizó Drive y que sí posee almacenamiento.
            return self.drive_configured() and bool(self._read_secret(self._secret_name(DRIVE)))
        return bool(self._read_secret(self._secret_name(integration)))

    @staticmethod
    def drive_configured() -> bool:
        """Drive usa la cuenta de servicio y destinos compartidos, no OAuth web."""
        return bool(os.getenv("ANGELI_DRIVE_IMAGES_FOLDER_ID") and os.getenv("ANGELI_DRIVE_FILES_FOLDER_ID"))

    def exchange_code(self, integration: str, code: str, redirect_uri: str) -> dict:
        if integration not in {*SCOPES, "identity"} or not code or len(code) > 4096:
            raise ValueError("Autorización no válida")
        token = self._post_form("https://oauth2.googleapis.com/token", {
            "code": code, "client_id": self.client_id, "client_secret": self._oauth_secret(),
            "redirect_uri": redirect_uri, "grant_type": "authorization_code",
        })
        if integration == "identity":
            identity = token.get("id_token")
            if not isinstance(identity, str) or not identity:
                raise RuntimeError("Google no devolvió identificación")
            return {"idToken": identity}
        refresh = token.get("refresh_token")
        if not isinstance(refresh, str) or not refresh:
            raise RuntimeError("Google no devolvió autorización permanente; vuelve a conceder el permiso")
        self._write_secret(self._secret_name(integration), json.dumps({"refresh_token": refresh}, separators=(",", ":")))
        return {"connected": True}

    def _access_token(self, integration: str) -> str:
        raw = self._read_secret(self._secret_name(integration))
        if not raw:
            raise PermissionError("Conecta primero esta integración")
        try:
            refresh = json.loads(raw)["refresh_token"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise RuntimeError("La autorización guardada no es válida") from error
        token = self._post_form("https://oauth2.googleapis.com/token", {
            "client_id": self.client_id, "client_secret": self._oauth_secret(),
            "refresh_token": refresh, "grant_type": "refresh_token",
        })
        if not token.get("access_token"):
            raise PermissionError("La autorización de Google ha caducado; conéctala de nuevo")
        return token["access_token"]

    def api(self, integration: str, method: str, url: str, body: dict | None = None) -> dict:
        token = self._access_token(integration)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(url, data=data, method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=10) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except Exception as error:
            status = getattr(error, "code", None)
            if status in {401, 403}:
                raise PermissionError("La autorización de Google ha caducado; conéctala de nuevo") from error
            raise RuntimeError("Google no pudo completar la operación") from error

    def upload_drive_file(self, data: bytes, name: str, mime_type: str, kind: str) -> dict:
        parent = self._drive_folder(kind)
        boundary = "angeli-media-boundary"
        metadata = json.dumps({"name": name, "parents": [parent]}, ensure_ascii=False).encode("utf-8")
        body = b"\r\n".join([
            f"--{boundary}".encode(), b"Content-Type: application/json; charset=UTF-8", b"", metadata,
            f"--{boundary}".encode(), f"Content-Type: {mime_type}".encode(), b"", data,
            f"--{boundary}--".encode(), b""
        ])
        response = self._drive_raw("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink", body, f"multipart/related; boundary={boundary}")
        result = json.loads(response[0].decode("utf-8"))
        return {"id": result["id"], "driveFileId": result["id"], "name": result.get("name", name), "type": result.get("mimeType", mime_type), "size": int(result.get("size", len(data))), "url": result.get("webViewLink", "")}

    def download_drive_file(self, file_id: str) -> tuple[bytes, str]:
        return self._drive_raw("GET", f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media")

    def delete_drive_file(self, file_id: str) -> None:
        self._drive_raw("DELETE", f"https://www.googleapis.com/drive/v3/files/{file_id}")

    def _drive_folder(self, kind: str) -> str:
        variable = "ANGELI_DRIVE_IMAGES_FOLDER_ID" if kind == "image" else "ANGELI_DRIVE_FILES_FOLDER_ID"
        folder_id = os.getenv(variable, "").strip()
        if not folder_id:
            raise RuntimeError("Drive no tiene una carpeta de destino configurada")
        return folder_id

    def _drive_raw(self, method: str, url: str, data: bytes | None = None, content_type: str = "application/json") -> tuple[bytes, str]:
        # Drive actúa con la autorización OAuth persistente del propietario,
        # igual que n8n, para que los ficheros consuman su cuota y no la
        # inexistente cuota de la cuenta de servicio de Cloud Run.
        request = Request(url, data=data, method=method, headers={"Authorization": f"Bearer {self._access_token(DRIVE)}", "Content-Type": content_type})
        try:
            with urlopen(request, timeout=30) as response:
                return response.read(), response.headers.get_content_type() or "application/octet-stream"
        except Exception as error:
            if getattr(error, "code", None) in {401, 403}:
                raise PermissionError("La autorización de Drive no puede escribir en la carpeta configurada") from error
            raise RuntimeError("Google Drive no pudo completar la operación") from error

    def _raw(self, integration: str, method: str, url: str, data: bytes | None = None, content_type: str = "application/json") -> tuple[bytes, str]:
        request = Request(url, data=data, method=method, headers={"Authorization": f"Bearer {self._access_token(integration)}", "Content-Type": content_type})
        try:
            with urlopen(request, timeout=30) as response:
                return response.read(), response.headers.get_content_type() or "application/octet-stream"
        except Exception as error:
            if getattr(error, "code", None) in {401, 403}:
                raise PermissionError("La autorización de Google ha caducado; conéctala de nuevo") from error
            raise RuntimeError("Google Drive no pudo completar la operación") from error

    @staticmethod
    def _post_form(url: str, values: dict) -> dict:
        request = Request(url, data=urlencode(values).encode("utf-8"), method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
