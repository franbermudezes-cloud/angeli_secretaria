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
SCOPES = {
    CONTACTS: "openid email https://www.googleapis.com/auth/contacts.readonly",
    CALENDAR: "openid email https://www.googleapis.com/auth/calendar.events",
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

    @staticmethod
    def _post_form(url: str, values: dict) -> dict:
        request = Request(url, data=urlencode(values).encode("utf-8"), method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
