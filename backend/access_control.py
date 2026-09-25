"""Control de acceso por invitación y cupo mensual de IA para Angeli.

La lista de invitados vivía antes en la variable de entorno
ALLOWED_FIREBASE_EMAILS, que obligaba a redesplegar el servidor cada vez que el
propietario quería dar de alta o cortar a alguien. Aquí la trasladamos a
Firestore (colección `access`, un documento por persona con el correo como id)
para que el propietario la administre en vivo desde la app, y añadimos un cupo
mensual por persona ("el grifo"): cada interacción de IA cuenta, y al agotarse
el cupo el servidor responde con un aviso claro en lugar de seguir gastando.

El propietario y la lista heredada de ALLOWED_FIREBASE_EMAILS siguen entrando
siempre y sin contador, para no romper el acceso existente aunque Firestore esté
vacío o no disponible.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

# Correo del propietario: acceso ilimitado y sin contador. Se resuelve por
# variable de entorno para no clavar una identidad en el código del servidor,
# con el mismo valor por defecto que usa el candado del cliente (firebase.js).
OWNER_EMAIL = os.getenv("ANGELI_OWNER_EMAIL", "franbermudez.es@gmail.com").strip().lower()

# Cupo de prueba por defecto para una invitación nueva sin límite propio.
DEFAULT_MONTHLY_LIMIT = int(os.getenv("ANGELI_DEFAULT_MONTHLY_LIMIT", "40"))

VALID_STATUS = {"active", "blocked"}
VALID_MODE = {"trial", "open"}


class AccessDenied(PermissionError):
    """La cuenta no está invitada o está cortada."""


class QuotaExhausted(RuntimeError):
    """La persona agotó su cupo mensual de IA."""


def current_period(now: datetime | None = None) -> str:
    """Periodo de facturación del cupo: año-mes en UTC (p. ej. "2026-09")."""
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


def _legacy_allowed() -> set[str]:
    return {value.strip().lower() for value in os.getenv("ALLOWED_FIREBASE_EMAILS", "").split(",") if value.strip()}


def _email_key(email: str) -> str:
    # Los correos son ids de documento válidos en Firestore (solo se prohíbe '/',
    # que un correo no contiene). Normalizamos a minúsculas para que el cliente y
    # el servidor apunten siempre al mismo documento.
    return (email or "").strip().lower()


class AccessControl:
    """Resuelve permisos y cupo. Acepta un almacén inyectado para pruebas.

    `store`, si se pasa, es un dict {correo: registro}. Sin él, se usa Firestore.
    Cada registro puede tener: name, status ("active"/"blocked"),
    mode ("trial"/"open"), monthlyLimit (int), usagePeriod, usageCount, uid.
    """

    def __init__(self, store: dict[str, dict[str, Any]] | None = None) -> None:
        self._store = store
        self.database = os.getenv("ANGELI_FIRESTORE_DATABASE", "angelifirebase")

    # --- almacenamiento ---
    def _db(self):
        import firebase_admin
        from firebase_admin import firestore

        try:
            app = firebase_admin.get_app()
        except ValueError:
            app = firebase_admin.initialize_app(options={"projectId": os.environ["GOOGLE_CLOUD_PROJECT"]})
        return firestore.client(app=app, database_id=self.database)

    def _get(self, email: str) -> dict[str, Any] | None:
        key = _email_key(email)
        if self._store is not None:
            record = self._store.get(key)
            return dict(record) if record else None
        # Firestore es el almacén real, pero su ausencia (sin proyecto, sin
        # credenciales, en pruebas) nunca debe tumbar una petición: se trata como
        # "sin invitación", de modo que solo el propietario y la lista heredada
        # entran mientras Firestore no esté disponible.
        try:
            snapshot = self._db().collection("access").document(key).get()
        except Exception:
            return None
        return snapshot.to_dict() if snapshot.exists else None

    def _merge(self, email: str, data: dict[str, Any]) -> None:
        key = _email_key(email)
        if self._store is not None:
            self._store.setdefault(key, {}).update(data)
            return
        try:
            self._db().collection("access").document(key).set(data, merge=True)
        except Exception:
            # No perder la interacción del usuario por un fallo al anotar el
            # contador: el peor caso es contar de menos, nunca cortar de más.
            pass

    # --- resolución de política ---
    def _policy(self, email: str) -> dict[str, Any] | None:
        key = _email_key(email)
        if not key:
            return None
        if key == OWNER_EMAIL:
            return {"owner": True, "mode": "owner", "status": "active", "name": "", "monthlyLimit": None}
        record = self._get(key)
        if record is None:
            if key in _legacy_allowed():
                return {"owner": False, "mode": "open", "status": "active", "name": "", "monthlyLimit": None, "legacy": True}
            return None
        return record

    def _limit_of(self, policy: dict[str, Any]) -> int | None:
        if policy.get("mode") in ("owner", "open"):
            return None
        raw = policy.get("monthlyLimit")
        try:
            return int(raw) if raw is not None else DEFAULT_MONTHLY_LIMIT
        except (TypeError, ValueError):
            return DEFAULT_MONTHLY_LIMIT

    def _usage(self, policy: dict[str, Any]) -> int:
        if policy.get("usagePeriod") != current_period():
            return 0
        try:
            return max(0, int(policy.get("usageCount") or 0))
        except (TypeError, ValueError):
            return 0

    # --- API pública ---
    def status(self, claims: dict[str, Any]) -> dict[str, Any]:
        """Estado de acceso para /access/status: qué ve el cliente al entrar."""
        if claims.get("bypass"):
            return {"allowed": True, "owner": True, "mode": "owner", "limit": None, "used": 0, "remaining": None, "name": ""}
        email = _email_key(claims.get("email"))
        if not email or not claims.get("email_verified"):
            return {"allowed": False, "owner": False, "reason": "unverified"}
        policy = self._policy(email)
        if policy is None:
            return {"allowed": False, "owner": False, "reason": "not_invited", "email": email}
        if policy.get("status") == "blocked":
            return {"allowed": False, "owner": False, "reason": "blocked", "email": email, "name": policy.get("name", "")}
        limit = self._limit_of(policy)
        used = self._usage(policy)
        return {
            "allowed": True,
            "owner": bool(policy.get("owner")),
            "mode": policy.get("mode", "trial"),
            "limit": limit,
            "used": used,
            "remaining": None if limit is None else max(0, limit - used),
            "name": policy.get("name", ""),
        }

    def is_owner(self, claims: dict[str, Any]) -> bool:
        """Propietario (o la lista heredada, que es la del propietario antes del multiusuario)."""
        if claims.get("bypass"):
            return True
        if not claims.get("email_verified"):
            return False
        policy = self._policy(_email_key(claims.get("email")))
        return bool(policy and (policy.get("owner") or policy.get("legacy")) and policy.get("status") != "blocked")

    def authorize(self, claims: dict[str, Any]) -> None:
        """Verifica que la cuenta puede usar Angeli. Lanza AccessDenied si no."""
        if claims.get("bypass"):
            return
        if not self.status(claims).get("allowed"):
            raise AccessDenied("Usuario no autorizado")

    def ensure_quota(self, claims: dict[str, Any]) -> None:
        """Comprueba que queda cupo SIN gastarlo (se cobra solo tras el éxito)."""
        if claims.get("bypass"):
            return
        policy = self._policy(_email_key(claims.get("email")))
        if policy is None or policy.get("status") == "blocked":
            raise AccessDenied("Usuario no autorizado")
        if policy.get("owner") or policy.get("legacy") or policy.get("mode", "trial") != "trial":
            return
        limit = self._limit_of(policy)
        if limit is not None and self._usage(policy) >= limit:
            raise QuotaExhausted("quota_exhausted")

    def consume(self, claims: dict[str, Any]) -> None:
        """Cobra una interacción de IA al cupo. Lanza QuotaExhausted si se agotó.

        El propietario y la lista heredada no gastan cupo. Las personas con grifo
        abierto ("open") cuentan para que el panel muestre su gasto, pero nunca se
        cortan; solo las de prueba ("trial") se frenan al llegar al tope.
        """
        if claims.get("bypass"):
            return
        email = _email_key(claims.get("email"))
        policy = self._policy(email)
        if policy is None or policy.get("status") == "blocked":
            raise AccessDenied("Usuario no autorizado")
        if policy.get("owner") or policy.get("legacy"):
            return
        used = self._usage(policy)
        if policy.get("mode", "trial") == "trial":
            limit = self._limit_of(policy)
            if limit is not None and used >= limit:
                raise QuotaExhausted("quota_exhausted")
        self._merge(email, {
            "usagePeriod": current_period(),
            "usageCount": used + 1,
            "uid": claims.get("uid") or claims.get("sub") or "",
            "lastSeen": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
