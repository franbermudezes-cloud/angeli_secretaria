"""Servicio aislado de interpretación para Angeli Secretaria.

Cloud Run usa su propia Service Account y Application Default Credentials para
llamar a Vertex AI. Este servicio no ejecuta acciones de negocio.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import defaultdict, deque
from datetime import date, datetime
from io import BytesIO
from typing import Any, Callable
from zoneinfo import ZoneInfo

MAX_TEXT_LENGTH = 500
MAX_BODY_BYTES = 2_048
REQUEST_TIMEOUT_SECONDS = 8
RATE_LIMIT_PER_MINUTE = 30
VALID_INTENTS = {
    "note",
    "task.create",
    "reminder.create",
    "calendar.create",
    "calendar.update",
    "calendar.delete",
    "contact.call",
    "file.store",
    "photo.store",
}
SENSITIVE_INTENTS = {"calendar.update", "calendar.delete", "contact.call"}
ALLOWED_FIELDS = {
    "intent",
    "confidence",
    "title",
    "date",
    "time",
    "location",
    "contactName",
    "phone",
    "notes",
    "target",
    "changes",
    "requiresConfirmation",
}

SYSTEM_INSTRUCTION = """Eres el intérprete de una secretaria personal en español.
Interpreta únicamente la orden actual usando la fecha/hora y zona horaria dadas.
Usa exclusivamente las intenciones permitidas por el esquema. Extrae solo datos
explícitos o inequívocos; no inventes fechas, horas, personas, teléfonos ni
ubicaciones. Si existe ambigüedad material, baja la confianza. No ejecutes ni
sugieras llamadas a APIs, almacenamiento ni acciones externas."""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": sorted(ALLOWED_FIELDS),
    "properties": {
        "intent": {"type": "string", "enum": sorted(VALID_INTENTS)},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "title": {"type": ["string", "null"]},
        "date": {"type": ["string", "null"]},
        "time": {"type": ["string", "null"]},
        "location": {"type": ["string", "null"]},
        "contactName": {"type": ["string", "null"]},
        "phone": {"type": ["string", "null"]},
        "notes": {"type": ["string", "null"]},
        "target": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "date", "time"],
                    "properties": {
                        "title": {"type": "string"},
                        "date": {"type": ["string", "null"]},
                        "time": {"type": ["string", "null"]},
                    },
                },
            ]
        },
        "changes": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "date": {"type": "string"},
                        "time": {"type": "string"},
                        "location": {"type": "string"},
                        "notes": {"type": "string"},
                    },
                },
            ]
        },
        "requiresConfirmation": {"type": "boolean"},
    },
}

_rate_windows: dict[str, deque[float]] = defaultdict(deque)
_interpreter: Callable[[str, str, str], dict[str, Any]] | None = None
_identity_verifier: Callable[[str], dict[str, Any]] | None = None


class OutputValidationError(ValueError):
    """La respuesta de Vertex no cumple el contrato de interpretación."""


def json_response(start_response: Callable, status: str, data: dict[str, Any], origin: str = ""):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    headers = [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", str(len(body)))]
    if origin:
        headers.extend(
            [
                ("Access-Control-Allow-Origin", origin),
                ("Vary", "Origin"),
                ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
                ("Access-Control-Allow-Methods", "POST, OPTIONS"),
            ]
        )
    start_response(status, headers)
    return [body]


def cors_preflight_response(start_response: Callable, origin: str):
    headers = [
        ("Access-Control-Allow-Origin", origin),
        ("Vary", "Origin"),
        ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
        ("Access-Control-Allow-Methods", "POST, OPTIONS"),
        ("Content-Length", "0"),
    ]
    start_response("204 No Content", headers)
    return []


def log_interpreter_error(category: str, error: Exception) -> None:
    """Registra únicamente diagnóstico técnico; nunca el texto de la entrada."""
    status = getattr(error, "status_code", None) or getattr(error, "code", None)
    if callable(status):
        status = status()
    print(f"interpreter_error category={category} type={type(error).__name__} status={status if status is not None else 'none'}", file=sys.stderr, flush=True)


def allowed_origin(environ: dict[str, Any]) -> str:
    origin = environ.get("HTTP_ORIGIN", "")
    allowed = {value.strip() for value in os.getenv("ALLOWED_ORIGINS", "").split(",") if value.strip()}
    return origin if origin and origin in allowed else ""


def parse_request(environ: dict[str, Any]) -> tuple[str, str, str]:
    length = int(environ.get("CONTENT_LENGTH") or 0)
    if length > MAX_BODY_BYTES:
        raise ValueError("La petición supera el tamaño permitido")
    try:
        payload = json.loads(environ["wsgi.input"].read(length or MAX_BODY_BYTES).decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("JSON de entrada no válido") from error
    if not isinstance(payload, dict) or set(payload) != {"text", "now", "timeZone"}:
        raise ValueError("Campos de entrada no válidos")
    text, now, timezone = payload["text"], payload["now"], payload["timeZone"]
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_LENGTH:
        raise ValueError("El texto debe tener entre 1 y 500 caracteres")
    if not isinstance(now, str) or len(now) > 40 or not isinstance(timezone, str) or len(timezone) > 64:
        raise ValueError("Contexto temporal no válido")
    try:
        if datetime.fromisoformat(now).tzinfo is None:
            raise ValueError
        ZoneInfo(timezone)
    except ValueError as error:
        raise ValueError("Contexto temporal no válido") from error
    return text.strip(), now, timezone


def verify_identity(environ: dict[str, Any]) -> str:
    if os.getenv("ANGELI_AI_DEV_BYPASS_AUTH") == "1" and not os.getenv("K_SERVICE"):
        return "local-test-user"
    token = environ.get("HTTP_AUTHORIZATION", "").removeprefix("Bearer ").strip()
    if not token:
        raise PermissionError("Falta identificación")
    verifier = _identity_verifier or google_identity_verifier
    claims = verifier(token)
    allowed_subs = {value.strip() for value in os.getenv("ALLOWED_GOOGLE_SUBS", "").split(",") if value.strip()}
    if not allowed_subs or claims.get("sub") not in allowed_subs:
        raise PermissionError("Usuario no autorizado")
    return claims["sub"]


def google_identity_verifier(token: str) -> dict[str, Any]:
    client_id = os.getenv("GOOGLE_WEB_CLIENT_ID", "")
    if not client_id:
        raise PermissionError("El servidor no está configurado")
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token

    return id_token.verify_oauth2_token(token, Request(), client_id)


def enforce_rate_limit(subject: str) -> None:
    now = time.monotonic()
    window = _rate_windows[subject]
    while window and now - window[0] >= 60:
        window.popleft()
    if len(window) >= RATE_LIMIT_PER_MINUTE:
        raise RuntimeError("Demasiadas solicitudes; inténtalo dentro de un minuto")
    window.append(now)


def validate_interpretation(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw) != ALLOWED_FIELDS:
        raise ValueError("Respuesta estructurada no válida")
    if raw["intent"] not in VALID_INTENTS or not isinstance(raw["confidence"], (int, float)) or not 0 <= raw["confidence"] <= 1:
        raise ValueError("Intención o confianza no válidas")
    result = dict(raw)
    for key in ("title", "location", "contactName", "phone", "notes"):
        value = result[key]
        if value is not None and (not isinstance(value, str) or len(value) > MAX_TEXT_LENGTH):
            raise ValueError("Texto de salida no válido")
        result[key] = value.strip() if isinstance(value, str) else None
    for key in ("date", "time"):
        validate_temporal(key, result[key])
    validate_target(result["target"])
    validate_changes(result["changes"])
    if not isinstance(result["requiresConfirmation"], bool):
        raise ValueError("Confirmación no válida")
    if result["intent"] in SENSITIVE_INTENTS:
        result["requiresConfirmation"] = True
    return result


def validate_temporal(kind: str, value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, str):
        raise ValueError("Fecha u hora no válida")
    if kind == "time":
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("Hora no válida")
        return
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise ValueError("Fecha no válida") from error


def validate_target(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, dict) or set(value) != {"title", "date", "time"} or not isinstance(value["title"], str):
        raise ValueError("Objetivo no válido")
    validate_temporal("date", value["date"])
    validate_temporal("time", value["time"])


def validate_changes(value: Any) -> None:
    if value is None:
        return
    allowed = {"title", "date", "time", "location", "notes"}
    if not isinstance(value, dict) or not value or not set(value).issubset(allowed):
        raise ValueError("Cambios no válidos")
    for key, item in value.items():
        if key in {"date", "time"}:
            validate_temporal(key, item)
        elif not isinstance(item, str) or len(item) > MAX_TEXT_LENGTH:
            raise ValueError("Cambio de texto no válido")


def vertex_interpret(text: str, now: str, timezone: str) -> dict[str, Any]:
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    if not project:
        raise RuntimeError("Falta GOOGLE_CLOUD_PROJECT")
    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project=project, location=os.getenv("VERTEX_LOCATION", "global"))
    prompt = f"Fecha/hora actual: {now}\nZona horaria: {timezone}\nOrden: {text}"
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_json_schema=RESPONSE_SCHEMA,
            max_output_tokens=400,
        ),
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response.parsed if response.parsed is not None else json.loads(response.text)


def app(environ: dict[str, Any], start_response: Callable):
    origin = allowed_origin(environ)
    if environ.get("REQUEST_METHOD") == "OPTIONS":
        return cors_preflight_response(start_response, origin)
    if environ.get("REQUEST_METHOD") != "POST" or environ.get("PATH_INFO") != "/interpret":
        return json_response(start_response, "404 Not Found", {"error": "No encontrado"}, origin)
    if environ.get("HTTP_ORIGIN") and not origin:
        return json_response(start_response, "403 Forbidden", {"error": "Origen no permitido"})
    try:
        text, now, timezone = parse_request(environ)
        subject = verify_identity(environ)
        enforce_rate_limit(subject)
        interpreter = _interpreter or vertex_interpret
        try:
            interpretation = validate_interpretation(interpreter(text, now, timezone))
        except ValueError as error:
            raise OutputValidationError from error
        return json_response(start_response, "200 OK", interpretation, origin)
    except PermissionError:
        return json_response(start_response, "401 Unauthorized", {"error": "No autorizado"}, origin)
    except OutputValidationError as error:
        log_interpreter_error("invalid_model_output", error)
        return json_response(start_response, "503 Service Unavailable", {"error": "Interpretación no disponible"}, origin)
    except ValueError as error:
        return json_response(start_response, "400 Bad Request", {"error": str(error)}, origin)
    except RuntimeError as error:
        if "Demasiadas" not in str(error):
            log_interpreter_error("runtime", error)
        return json_response(start_response, "429 Too Many Requests" if "Demasiadas" in str(error) else "503 Service Unavailable", {"error": "Interpretación no disponible"}, origin)
    except Exception as error:
        log_interpreter_error("unexpected", error)
        return json_response(start_response, "503 Service Unavailable", {"error": "Interpretación no disponible"}, origin)


def set_test_dependencies(interpreter: Callable[[str, str, str], dict[str, Any]] | None = None, verifier: Callable[[str], dict[str, Any]] | None = None) -> None:
    global _interpreter, _identity_verifier
    _interpreter, _identity_verifier = interpreter, verifier


def wsgi_request(payload: dict[str, Any], authorization: str = "") -> tuple[str, dict[str, Any]]:
    """Ayuda exclusiva de pruebas locales; no se usa en Cloud Run."""
    body = json.dumps(payload).encode("utf-8")
    captured: dict[str, Any] = {}

    def start_response(status: str, headers: list[tuple[str, str]]):
        captured["status"], captured["headers"] = status, headers

    response = b"".join(app({"REQUEST_METHOD": "POST", "PATH_INFO": "/interpret", "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": authorization}, start_response))
    return captured["status"], json.loads(response)
