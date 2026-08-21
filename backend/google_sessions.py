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
  DRIVE: "openid email https://www.googleapis.com/auth/drive.file",
}


class GoogleSessions:
    def __init__(self, project: str, client_id: str):
        self.project, self.client_id = project, client_id

    def _secret_name(self, integration: str) -> str:
        return f"angeli-google-{integration}-grant"

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
        value = self._read_secret("angeli-oauth-client-secret")
        if not value:
            raise RuntimeError("Falta el secreto OAuth del servidor")
        return value

    def connected(self, integration: str) -> bool:
        return bool(self._read_secret(self._secret_name(integration)))

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
        response = self._raw(DRIVE, "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink", body, f"multipart/related; boundary={boundary}")
        result = json.loads(response[0].decode("utf-8"))
        return {"id": result["id"], "driveFileId": result["id"], "name": result.get("name", name), "type": result.get("mimeType", mime_type), "size": int(result.get("size", len(data))), "url": result.get("webViewLink", "")}

    def download_drive_file(self, file_id: str) -> tuple[bytes, str]:
        return self._raw(DRIVE, "GET", f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media")

    def delete_drive_file(self, file_id: str) -> None:
        self._raw(DRIVE, "DELETE", f"https://www.googleapis.com/drive/v3/files/{file_id}")

    def _drive_folder(self, kind: str) -> str:
        from datetime import datetime
        now = datetime.now()
        root = self._find_or_create_folder("Angeli Secretaria", "root")
        section = self._find_or_create_folder("Fotos" if kind == "image" else "Archivos", root)
        year = self._find_or_create_folder(str(now.year), section)
        return self._find_or_create_folder(f"{now.month:02d}", year)

    def _find_or_create_folder(self, name: str, parent: str) -> str:
        safe_name = name.replace("'", "\\'")
        query = urlencode({"q": f"name = '{safe_name}' and mimeType = 'application/vnd.google-apps.folder' and '{parent}' in parents and trashed = false", "fields": "files(id)", "pageSize": "1"})
        found = self.api(DRIVE, "GET", "https://www.googleapis.com/drive/v3/files?" + query).get("files", [])
        if found: return found[0]["id"]
        created = self.api(DRIVE, "POST", "https://www.googleapis.com/drive/v3/files", {"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent]})
        return created["id"]

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
