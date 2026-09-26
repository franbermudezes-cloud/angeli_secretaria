"""Autorizaciones persistentes de Google de cada persona de Angeli.

Los refresh tokens nunca salen de Cloud Run: se guardan por integración en
Secret Manager y las llamadas a People/Calendar se realizan desde este módulo.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from urllib.parse import quote, urlencode
from urllib.error import HTTPError, URLError
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

# Autorizaciones de las personas invitadas: cada una tiene las SUYAS, con este
# prefijo seguido de un resumen de su uid. Son las únicas que el servidor puede
# crear; las del propietario (angeli-google-*) y las del arnés
# (angeli-test-google-*) ya existen y nunca se crean ni se sustituyen desde aquí.
GUEST_GRANT_PREFIX = "angeli-google-u-"
PERSONAL_DRIVE_FOLDER = "Angeli"


class GoogleResourceNotFound(RuntimeError):
    def __init__(self, status_code: int):
        super().__init__("El recurso de Google ya no existe")
        self.status_code = status_code


class GoogleReconnectRequired(PermissionError):
    """El consentimiento existió, pero el refresh token ya no sirve."""


class GooglePermissionRequired(PermissionError):
    """La sesión existe, pero no autoriza la operación comprobada."""


class GoogleSessions:
    def __init__(self, project: str, client_id: str, grant_prefix: str = "angeli-google", personal_drive: bool = False):
        """Sesiones OAuth persistentes de un perfil de Angeli.

        ``angeli-google`` es siempre el perfil de producción. El arnés de
        pruebas usa explícitamente ``angeli-test-google`` para que una prueba
        no pueda leer, sustituir ni invalidar una autorización real.
        """
        if not grant_prefix or not grant_prefix.replace("-", "").isalnum():
            raise ValueError("Prefijo de autorizaciones no válido")
        self.project, self.client_id, self.grant_prefix = project, client_id, grant_prefix
        # Una persona invitada guarda sus adjuntos en una carpeta «Angeli» de SU
        # Drive; el propietario sigue usando las carpetas configuradas.
        self.personal_drive = personal_drive
        self._personal_folder_id: str | None = None

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
        client = self._client()
        request = {"parent": f"projects/{self.project}/secrets/{name}", "payload": {"data": value.encode("utf-8")}}
        try:
            client.add_secret_version(request=request)
        except Exception as error:
            # La primera vez que una persona invitada conecta, su secreto aún no
            # existe y se crea. Solo para invitados: jamás se crea un secreto del
            # propietario o del arnés con otro nombre por error.
            if type(error).__name__ != "NotFound" or not name.startswith(GUEST_GRANT_PREFIX):
                raise
            client.create_secret(request={"parent": f"projects/{self.project}", "secret_id": name, "secret": {"replication": {"automatic": {}}, "labels": {"angeli": "guest-grant"}}})
            client.add_secret_version(request=request)

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
            return (self.personal_drive or self.drive_configured()) and bool(self._read_secret(self._secret_name(DRIVE)))
        return bool(self._read_secret(self._secret_name(integration)))

    def connection_status(self, integration: str, drive_folder_ids: list[str] | None = None) -> dict:
        """Comprueba de verdad el grant y una lectura mínima de la API.

        No crea, modifica ni elimina recursos. Un secreto existente no se
        considera conexión hasta que Google acepta su refresh token y la API
        concreta permite leer el recurso mínimo configurado. Las operaciones de
        escritura conservan su validación propia cuando se ejecutan.
        """
        if integration not in SCOPES:
            raise ValueError("Integración no válida")
        try:
            if not self._read_secret(self._secret_name(integration)):
                return {"state": "disconnected", "reason": "missing_grant"}
            if integration == CONTACTS:
                self.api(CONTACTS, "GET", "https://people.googleapis.com/v1/people/me/connections?pageSize=1&personFields=names")
            elif integration == CALENDAR:
                params = urlencode({
                    "singleEvents": "true", "maxResults": "1",
                    "timeMin": datetime.now(timezone.utc).isoformat(),
                })
                self.api(CALENDAR, "GET", f"https://www.googleapis.com/calendar/v3/calendars/primary/events?{params}")
            else:
                folders = drive_folder_ids if drive_folder_ids is not None else [
                    os.getenv("ANGELI_DRIVE_IMAGES_FOLDER_ID", "").strip(),
                    os.getenv("ANGELI_DRIVE_FILES_FOLDER_ID", "").strip(),
                ]
                folders = list(dict.fromkeys(folder for folder in folders if folder))
                if not folders and not self.personal_drive:
                    return {"state": "disconnected", "reason": "missing_configuration"}
                # ``drive.file`` permite crear los adjuntos de Angeli en el
                # destino compartido, pero no garantiza que una carpeta ajena
                # pueda inspeccionarse con files.get. Verificamos aquí el grant
                # y la API sin escribir; P06 valida después la carpeta concreta
                # mediante una subida real y su limpieza.
                self.api(DRIVE, "GET", "https://www.googleapis.com/drive/v3/about?fields=user(permissionId)")
            return {"state": "connected", "reason": "verified"}
        except GoogleReconnectRequired:
            return {"state": "reconnect_required", "reason": "invalid_grant"}
        except GooglePermissionRequired:
            return {"state": "permission_required", "reason": "insufficient_permissions"}
        except GoogleResourceNotFound:
            return {"state": "permission_required", "reason": "resource_not_found"}
        except Exception:
            return {"state": "unavailable", "reason": "verification_failed"}

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
            raise GoogleReconnectRequired("Conecta primero esta integración")
        try:
            refresh = json.loads(raw)["refresh_token"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise RuntimeError("La autorización guardada no es válida") from error
        token = self._post_form("https://oauth2.googleapis.com/token", {
            "client_id": self.client_id, "client_secret": self._oauth_secret(),
            "refresh_token": refresh, "grant_type": "refresh_token",
        })
        if not token.get("access_token"):
            raise GoogleReconnectRequired("La autorización de Google ha caducado; conéctala de nuevo")
        return token["access_token"]

    def api(self, integration: str, method: str, url: str, body: dict | None = None) -> dict:
        token = self._access_token(integration)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(url, data=data, method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=10) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as error:
            status = error.code
            if status == 401:
                raise GoogleReconnectRequired("La autorización de Google ha caducado; conéctala de nuevo") from error
            if status == 403:
                if self._is_temporary_google_error(error):
                    raise RuntimeError("Google está temporalmente ocupado") from error
                raise GooglePermissionRequired("La autorización no incluye los permisos necesarios") from error
            if status in {404, 410}:
                raise GoogleResourceNotFound(status) from error
            raise RuntimeError("Google no pudo completar la operación") from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError("Google no está disponible temporalmente") from error

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
        if self.personal_drive:
            return self._personal_folder()
        variable = "ANGELI_DRIVE_IMAGES_FOLDER_ID" if kind == "image" else "ANGELI_DRIVE_FILES_FOLDER_ID"
        folder_id = os.getenv(variable, "").strip()
        if not folder_id:
            raise RuntimeError("Drive no tiene una carpeta de destino configurada")
        return folder_id

    def _personal_folder(self) -> str:
        """Carpeta «Angeli» en el Drive de la persona; se crea la primera vez.

        Con ``drive.file`` Angeli solo ve lo que ella misma ha creado, así que
        la búsqueda nunca encuentra ni toca otras carpetas de esa persona.
        """
        if self._personal_folder_id:
            return self._personal_folder_id
        query = f"name = '{PERSONAL_DRIVE_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        found = self.api(DRIVE, "GET", "https://www.googleapis.com/drive/v3/files?" + urlencode({"q": query, "fields": "files(id)", "pageSize": "1", "spaces": "drive"}, quote_via=quote))
        files = found.get("files") or []
        if files:
            self._personal_folder_id = files[0]["id"]
        else:
            created = self.api(DRIVE, "POST", "https://www.googleapis.com/drive/v3/files?fields=id", {"name": PERSONAL_DRIVE_FOLDER, "mimeType": "application/vnd.google-apps.folder"})
            self._personal_folder_id = created["id"]
        return self._personal_folder_id

    def _drive_raw(self, method: str, url: str, data: bytes | None = None, content_type: str = "application/json") -> tuple[bytes, str]:
        # Drive actúa con la autorización OAuth persistente del propietario,
        # igual que n8n, para que los ficheros consuman su cuota y no la
        # inexistente cuota de la cuenta de servicio de Cloud Run.
        request = Request(url, data=data, method=method, headers={"Authorization": f"Bearer {self._access_token(DRIVE)}", "Content-Type": content_type})
        try:
            with urlopen(request, timeout=30) as response:
                return response.read(), response.headers.get_content_type() or "application/octet-stream"
        except HTTPError as error:
            if error.code == 401:
                raise GoogleReconnectRequired("La autorización de Drive ha caducado; conéctala de nuevo") from error
            if error.code == 403 and not self._is_temporary_google_error(error):
                raise GooglePermissionRequired("Drive no puede escribir en la carpeta configurada") from error
            raise RuntimeError("Google Drive no pudo completar la operación") from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError("Google Drive no está disponible temporalmente") from error

    def _raw(self, integration: str, method: str, url: str, data: bytes | None = None, content_type: str = "application/json") -> tuple[bytes, str]:
        request = Request(url, data=data, method=method, headers={"Authorization": f"Bearer {self._access_token(integration)}", "Content-Type": content_type})
        try:
            with urlopen(request, timeout=30) as response:
                return response.read(), response.headers.get_content_type() or "application/octet-stream"
        except HTTPError as error:
            if error.code == 401:
                raise GoogleReconnectRequired("La autorización de Google ha caducado; conéctala de nuevo") from error
            if error.code == 403 and not self._is_temporary_google_error(error):
                raise GooglePermissionRequired("La autorización no incluye los permisos necesarios") from error
            raise RuntimeError("Google Drive no pudo completar la operación") from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError("Google Drive no está disponible temporalmente") from error

    @staticmethod
    def _post_form(url: str, values: dict) -> dict:
        request = Request(url, data=urlencode(values).encode("utf-8"), method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            payload = GoogleSessions._http_error_payload(error)
            reason = payload.get("error")
            if reason == "invalid_grant":
                raise GoogleReconnectRequired("La autorización guardada ha caducado o fue revocada") from error
            if reason in {"invalid_client", "unauthorized_client"}:
                raise RuntimeError("El cliente OAuth del servidor no es válido") from error
            raise RuntimeError("Google no pudo completar la autorización") from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError("Google no está disponible temporalmente") from error

    @staticmethod
    def _http_error_payload(error: HTTPError) -> dict:
        try:
            value = json.loads(error.read().decode("utf-8"))
            return value if isinstance(value, dict) else {}
        except (AttributeError, UnicodeDecodeError, json.JSONDecodeError):
            return {}

    @staticmethod
    def _is_temporary_google_error(error: HTTPError) -> bool:
        payload = GoogleSessions._http_error_payload(error)
        status = str(payload.get("error", {}).get("status", "")) if isinstance(payload.get("error"), dict) else ""
        reasons = {
            str(item.get("reason", ""))
            for item in payload.get("error", {}).get("errors", [])
            if isinstance(item, dict)
        } if isinstance(payload.get("error"), dict) else set()
        return status in {"RESOURCE_EXHAUSTED", "UNAVAILABLE"} or bool(reasons & {"rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"})
