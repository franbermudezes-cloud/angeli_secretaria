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
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from google_sessions import CALENDAR, CONTACTS, DRIVE, GoogleResourceNotFound, GoogleSessions

MAX_TEXT_LENGTH = 500
MAX_BODY_BYTES = 2_048
MAX_MEDIA_BYTES = 20 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 8
RATE_LIMIT_PER_MINUTE = 30
VALID_INTENTS = {
    "note",
    "task.create",
    "task.complete",
    "reminder.create",
    "reminder.query",
    "calendar.create",
    "calendar.query",
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
    "rangeStart",
    "rangeEnd",
    "location",
    "contactName",
    "phone",
    "notes",
    "target",
    "changes",
    "requiresConfirmation",
    "missingFields",
    "question",
}

SYSTEM_INSTRUCTION = """Eres el intérprete de una secretaria personal en español.
Interpreta la orden actual usando la fecha/hora y zona horaria dadas. Si se
incluye CONTEXTO ACTIVO, la orden actual es una respuesta a esa misma operación:
completa sus datos y conserva su intención, salvo que la persona cancele
explícitamente la operación.
Usa exclusivamente las intenciones permitidas por el esquema. Extrae solo datos
explícitos o inequívocos; no inventes fechas, horas, personas, teléfonos ni
ubicaciones. Si existe ambigüedad material, baja la confianza.

Para calendar.create, separa obligatoriamente los datos: title es un nombre
breve del evento, sin fecha, hora ni lugar; location es el recinto, dirección,
restaurante o población donde sucede el evento, conservando el lugar completo.
Elimina del título fórmulas administrativas como «está contratado» o
«contratada». Por ejemplo, «Está contratada discomóvil en Complejo San Marcos
de Gandía el 29 de agosto a las siete de la tarde» debe producir title
«Discomóvil» y location «Complejo San Marcos de Gandía». Si no se expresa un
lugar físico, location debe ser null.

Para cancelar usa calendar.delete. En target.title expresa el criterio estable
más corto que identifica el evento, normalmente la persona, lugar o asunto
distintivo, y omite categorías genéricas como cita, quedada, reunión, llamada,
evento o recordatorio. Por ejemplo, «Anula cita con Miguel» debe producir
target.title «Miguel» aunque el evento pueda llamarse «Quedada con Miguel».
Conserva en target la fecha u hora solo si se menciona. Para modificar usa
calendar.update con el mismo criterio semántico mínimo: target identifica el
evento actual y changes contiene solo los nuevos datos. Por ejemplo,
«cámbiame la hora de Miguel» mantiene target.title «Miguel» y pregunta la
nueva hora si todavía no se ha dicho. Para
órdenes como «cámbiame la hora de llamar a Miguel», «modifícame la llamada de
Miguel» o «reprograma el recordatorio de Miguel», calendar.update tiene
prioridad absoluta sobre contact.call: la palabra «llamar» describe el evento
existente y nunca significa llamar ahora. Si todavía no se indica la nueva
fecha u hora, devuelve calendar.update, conserva a Miguel en target.title,
deja changes en null y pregunta brevemente cuándo debe reprogramarse.
Para
preguntas sobre la agenda usa calendar.query. En una consulta de intervalo,
como «qué tengo la semana que viene», usa rangeStart y rangeEnd en formato
YYYY-MM-DD, con el inicio inclusivo y el fin exclusivo. En calendar.query,
title debe ser null: la pregunta completa nunca es el título de un evento ni
un filtro de texto. Para «pasa la cena con
Vicente para el lunes que viene», target debe identificar «Cena con Vicente»
y changes debe contener la nueva fecha; nunca uses esa nueva fecha para buscar
el evento antiguo. Si una orden de creación contiene «en» seguido de un
recinto, restaurante, dirección o población, location debe contener ese lugar
completo y title no debe copiarlo. Nunca copies la frase completa dictada como
título de un evento.
Para una llamada, tarea o recordatorio con fecha Y hora futuras, usa
reminder.create, no contact.call ni calendar.create. Conserva la fecha y la
hora; si se trata de una llamada, contactName debe contener solo el nombre de
la persona y title debe describir brevemente la acción, por ejemplo «Llamar a
Miguel Ibiza». contact.call se reserva exclusivamente para llamadas que deben
ocurrir ahora. Ejemplo: «Llama a Miguel Ibiza mañana a las nueve de la noche»
produce reminder.create, contactName «Miguel Ibiza», fecha y hora; nunca debe
abrir el marcador en ese momento.
Para reminder.create, si se dice una hora pero no un día, usa la fecha de
`now` cuando esa hora aún está por llegar; si ya pasó, usa el día siguiente.
Interpreta «a las dos y cuarto», «a las 2 y 15 minutos» y expresiones
equivalentes con la hora natural más próxima según `now`; conserva siempre la
hora en formato de 24 horas. El aviso nunca se programa sin confirmación de la
persona usuaria.
Para indicar que un pendiente ya se ha realizado, como «Ya he llamado a
Miguel», usa task.complete. target.title debe identificar brevemente el
pendiente existente, por ejemplo «Miguel» o «Llamar a Miguel». No crees
una tarea, nota ni llamada nueva. Si hay varias coincidencias, la aplicación
pedirá a la persona que elija una.
Para consultar recordatorios pendientes guardados en Angeli, como «¿Qué
recordatorios tengo de Miguel?», usa reminder.query. target.title debe contener
solo el criterio solicitado, por ejemplo «Miguel». Si pide todos los
recordatorios, target y contactName deben ser null. title debe ser null;
la pregunta completa nunca es un filtro. Esta consulta no crea una
entrada nueva ni consulta Google Calendar.
Si faltan datos imprescindibles para calendar.create o reminder.create, indica
en missingFields los nombres de los campos que faltan (date, time, title,
location, contactName, phone o target) y formula una única pregunta breve en
question. No inventes ni conviertas una operación incompleta en una nota. Si no
falta nada, missingFields debe ser [] y question debe ser null.
No ejecutes ni sugieras llamadas a APIs, almacenamiento ni acciones externas."""

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
        "rangeStart": {"type": ["string", "null"]},
        "rangeEnd": {"type": ["string", "null"]},
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
        "missingFields": {"type": "array", "items": {"type": "string", "enum": ["title", "date", "time", "location", "contactName", "phone", "target"]}, "maxItems": 7},
        "question": {"type": ["string", "null"]},
    },
}

_rate_windows: dict[str, deque[float]] = defaultdict(deque)
_interpreter: Callable[[str, str, str], dict[str, Any]] | None = None
_identity_verifier: Callable[[str], dict[str, Any]] | None = None
_sessions_factory: Callable[[], GoogleSessions] | None = None


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
                ("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Angeli-Name, X-Angeli-Type, X-Angeli-Kind, X-Angeli-Entry"),
                ("Access-Control-Allow-Methods", "POST, OPTIONS"),
            ]
        )
    start_response(status, headers)
    return [body]


def cors_preflight_response(start_response: Callable, origin: str):
    headers = [
        ("Access-Control-Allow-Origin", origin),
        ("Vary", "Origin"),
        ("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Angeli-Name, X-Angeli-Type, X-Angeli-Kind, X-Angeli-Entry"),
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
    detail = "none"
    if isinstance(error, TypeError):
        match = re.search(r"unexpected keyword argument ['\"]([^'\"]+)['\"]", str(error))
        detail = f"unexpected_keyword={match.group(1)}" if match else "type_error_without_keyword"
    elif isinstance(error, OutputValidationError):
        # El mensaje procede únicamente de validadores internos; nunca contiene
        # el texto dictado ni la respuesta completa del modelo.
        detail = str(error)[:120] or "validation_error"
    print(f"interpreter_error category={category} type={type(error).__name__} status={status if status is not None else 'none'} detail={detail}", file=sys.stderr, flush=True)


def allowed_origin(environ: dict[str, Any]) -> str:
    origin = environ.get("HTTP_ORIGIN", "")
    return origin if origin and origin in configured_origins() else ""


def configured_origins() -> set[str]:
    return {value.strip() for value in os.getenv("ALLOWED_ORIGINS", "").split(",") if value.strip()}


def parse_request(environ: dict[str, Any]) -> tuple[str, str, str, dict[str, Any] | None]:
    length = int(environ.get("CONTENT_LENGTH") or 0)
    if length > MAX_BODY_BYTES:
        raise ValueError("La petición supera el tamaño permitido")
    try:
        payload = json.loads(environ["wsgi.input"].read(length or MAX_BODY_BYTES).decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("JSON de entrada no válido") from error
    if not isinstance(payload, dict) or not {"text", "now", "timeZone"}.issubset(payload) or not set(payload).issubset({"text", "now", "timeZone", "context"}):
        raise ValueError("Campos de entrada no válidos")
    text, now, timezone, context = payload["text"], payload["now"], payload["timeZone"], payload.get("context")
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
    return text.strip(), now, timezone, validate_context(context)


def validate_context(value: Any) -> dict[str, Any] | None:
    """Acepta solo el resumen de una interacción, nunca estado arbitrario de UI."""
    if value is None:
        return None
    if not isinstance(value, dict) or not set(value).issubset({"interactionId", "intent", "status", "collectedData", "missingFields", "question", "turns"}):
        raise ValueError("Contexto conversacional no válido")
    interaction_id = value.get("interactionId")
    intent = value.get("intent")
    status = value.get("status")
    if not isinstance(interaction_id, str) or len(interaction_id) > 100 or intent not in VALID_INTENTS or status not in {"awaiting_input", "pending_confirmation", "executing"}:
        raise ValueError("Contexto conversacional no válido")
    collected = value.get("collectedData", {})
    if not isinstance(collected, dict) or not set(collected).issubset({"title", "date", "time", "rangeStart", "rangeEnd", "location", "contactName", "phone", "notes", "target", "changes"}):
        raise ValueError("Contexto conversacional no válido")
    missing = value.get("missingFields", [])
    if not isinstance(missing, list) or len(missing) > 7 or any(item not in {"title", "date", "time", "location", "contactName", "phone", "target"} for item in missing):
        raise ValueError("Contexto conversacional no válido")
    turns = value.get("turns", [])
    if not isinstance(turns, list) or len(turns) > 6:
        raise ValueError("Contexto conversacional no válido")
    safe_turns = []
    for turn in turns:
        if not isinstance(turn, dict) or set(turn) != {"role", "text"} or turn["role"] not in {"user", "assistant"} or not isinstance(turn["text"], str) or len(turn["text"]) > MAX_TEXT_LENGTH:
            raise ValueError("Contexto conversacional no válido")
        safe_turns.append({"role": turn["role"], "text": turn["text"]})
    return {"interactionId": interaction_id, "intent": intent, "status": status, "collectedData": collected, "missingFields": missing, "question": value.get("question") if isinstance(value.get("question"), str) else None, "turns": safe_turns}


def parse_json_body(environ: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
    length = int(environ.get("CONTENT_LENGTH") or 0)
    if length > MAX_BODY_BYTES:
        raise ValueError("La petición supera el tamaño permitido")
    try:
        payload = json.loads(environ["wsgi.input"].read(length or MAX_BODY_BYTES).decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("JSON de entrada no válido") from error
    if not isinstance(payload, dict) or not set(payload).issubset(allowed):
        raise ValueError("Campos de entrada no válidos")
    return payload


def sessions() -> GoogleSessions:
    if _sessions_factory:
        return _sessions_factory()
    project, client_id = os.getenv("GOOGLE_CLOUD_PROJECT", ""), os.getenv("GOOGLE_WEB_CLIENT_ID", "")
    if not project or not client_id:
        raise RuntimeError("El servidor no está configurado")
    return GoogleSessions(project, client_id)


def test_sessions() -> GoogleSessions:
    """Perfil de pruebas, aislado por secretos de las sesiones reales."""
    if _sessions_factory:
        return _sessions_factory()
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    client_id = os.getenv("ANGELI_TEST_GOOGLE_WEB_CLIENT_ID", "")
    if not project or not client_id:
        raise RuntimeError("El perfil OAuth aislado de pruebas no está configurado")
    return GoogleSessions(project, client_id, grant_prefix="angeli-test-google")


def session_status() -> dict[str, Any]:
    service = sessions()
    return {"ai": True, "contacts": service.connected(CONTACTS), "calendar": service.connected(CALENDAR), "drive": service.connected(DRIVE)}


def test_session_status() -> dict[str, Any]:
    service = test_sessions()
    return {"contacts": service.connected(CONTACTS), "calendar": service.connected(CALENDAR), "drive": service.connected(DRIVE)}


def parse_media_upload(environ: dict[str, Any]) -> tuple[bytes, str, str, str]:
    length = int(environ.get("CONTENT_LENGTH") or 0)
    if not 0 < length <= MAX_MEDIA_BYTES:
        raise ValueError("El archivo debe tener entre 1 byte y 20 MB")
    name = environ.get("HTTP_X_ANGELI_NAME", "")
    mime_type = environ.get("HTTP_X_ANGELI_TYPE", "application/octet-stream")
    kind = environ.get("HTTP_X_ANGELI_KIND", "")
    if kind not in {"image", "file"} or not name or len(name) > 255 or len(mime_type) > 150:
        raise ValueError("Datos de archivo no válidos")
    from urllib.parse import unquote
    name = unquote(name).replace("/", "_").replace("\\", "_").strip()
    if not name:
        raise ValueError("Nombre de archivo no válido")
    data = environ["wsgi.input"].read(length)
    if len(data) != length:
        raise ValueError("No se pudo recibir el archivo completo")
    return data, name, mime_type, kind


def media_response(start_response: Callable, data: bytes, content_type: str, origin: str):
    headers = [("Content-Type", content_type), ("Content-Length", str(len(data))), ("Content-Disposition", "inline")]
    if origin:
        headers.extend([("Access-Control-Allow-Origin", origin), ("Vary", "Origin")])
    start_response("200 OK", headers)
    return [data]


def persistent_google_action(payload: dict[str, Any]) -> dict[str, Any]:
    integration, action = payload.get("integration"), payload.get("action")
    service = sessions()
    if integration == CONTACTS and action == "search":
        query = payload.get("query")
        if not isinstance(query, str) or not query.strip() or len(query) > 100:
            raise ValueError("Búsqueda no válida")
        url = "https://people.googleapis.com/v1/people:searchContacts?" + urlencode({"query": query.strip(), "readMask": "names,phoneNumbers", "pageSize": "10", "sources": "READ_SOURCE_TYPE_CONTACT"})
        return service.api(CONTACTS, "GET", url)
    if integration != CALENDAR:
        raise ValueError("Integración no válida")
    calendar_id = "primary"
    base = f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
    if action == "create" and isinstance(payload.get("event"), dict):
        return {"calendarId": calendar_id, **service.api(CALENDAR, "POST", base, payload["event"])}
    if action == "list" and isinstance(payload.get("params"), dict):
        params = {key: str(value) for key, value in payload["params"].items() if key in {"singleEvents", "orderBy", "maxResults", "timeMin", "timeMax", "q", "pageToken"}}
        if len(params.get("pageToken", "")) > 2000:
            raise ValueError("Página de Calendar no válida")
        return {"calendarId": calendar_id, **service.api(CALENDAR, "GET", base + "?" + urlencode(params))}
    event_id = payload.get("eventId")
    if not isinstance(event_id, str) or not event_id or len(event_id) > 300:
        raise ValueError("Evento no válido")
    url = base + "/" + quote(event_id, safe="")
    if action == "get":
        try:
            event = service.api(CALENDAR, "GET", url)
        except GoogleResourceNotFound:
            return {"calendarId": calendar_id, "eventId": event_id, "exists": False}
        return {"calendarId": calendar_id, "eventId": event_id,
                "exists": event.get("status") != "cancelled", "event": event}
    if action == "delete":
        return {"calendarId": calendar_id, **service.api(CALENDAR, "DELETE", url)}
    if action == "patch" and isinstance(payload.get("event"), dict):
        return {"calendarId": calendar_id, **service.api(CALENDAR, "PATCH", url, payload["event"])}
    raise ValueError("Acción no válida")


def verify_identity(environ: dict[str, Any]) -> str:
    if os.getenv("ANGELI_AI_DEV_BYPASS_AUTH") == "1" and not os.getenv("K_SERVICE"):
        return "local-test-user"
    token = environ.get("HTTP_AUTHORIZATION", "").removeprefix("Bearer ").strip()
    if not token:
        raise PermissionError("Falta identificación")
    verifier = _identity_verifier or firebase_identity_verifier
    claims = verifier(token)
    allowed_emails = {value.strip().lower() for value in os.getenv("ALLOWED_FIREBASE_EMAILS", "").split(",") if value.strip()}
    email = str(claims.get("email") or "").lower()
    if not allowed_emails or not claims.get("email_verified") or email not in allowed_emails:
        raise PermissionError("Usuario no autorizado")
    return str(claims.get("uid") or claims.get("sub") or "")


def firebase_identity_verifier(token: str) -> dict[str, Any]:
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    if not project:
        raise PermissionError("El servidor no está configurado")
    import firebase_admin
    from firebase_admin import auth as firebase_auth

    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(options={"projectId": project})
    return firebase_auth.verify_id_token(token)


def enforce_rate_limit(subject: str) -> None:
    now = time.monotonic()
    window = _rate_windows[subject]
    while window and now - window[0] >= 60:
        window.popleft()
    if len(window) >= RATE_LIMIT_PER_MINUTE:
        raise RuntimeError("Demasiadas solicitudes; inténtalo dentro de un minuto")
    window.append(now)


def validate_interpretation(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or not set(raw).issubset(ALLOWED_FIELDS):
        raise ValueError("Respuesta estructurada no válida")
    if raw.get("intent") not in VALID_INTENTS or not isinstance(raw.get("confidence"), (int, float)) or not 0 <= raw["confidence"] <= 1:
        raise ValueError("Intención o confianza no válidas")
    result = {field: raw.get(field) for field in ALLOWED_FIELDS}
    # Gemini puede completar campos auxiliares que no aplican a la intención
    # solicitada. No dejamos que esos datos inofensivos conviertan una orden
    # válida de recordatorio en un fallo global de interpretación.
    if result["intent"] not in {"calendar.update", "calendar.delete", "task.complete", "reminder.query"}:
        result["target"] = None
    if result["intent"] != "calendar.update":
        result["changes"] = None
    if result["intent"] != "calendar.query":
        result["rangeStart"] = None
        result["rangeEnd"] = None
    else:
        # Una pregunta de agenda se resuelve por intervalo, no con sus
        # propias palabras como filtro de título de Calendar.
        result["title"] = None
    for key in ("title", "location", "contactName", "phone", "notes", "question"):
        value = result[key]
        if value is not None and (not isinstance(value, str) or len(value) > MAX_TEXT_LENGTH):
            raise ValueError("Texto de salida no válido")
        result[key] = value.strip() if isinstance(value, str) else None
    # Gemini puede incluir segundos cero: no cambian la hora del contrato HH:MM.
    # No truncar segundos reales ni convertir horas fuera de rango.
    if isinstance(result["time"], str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d:00", result["time"]):
        result["time"] = result["time"][:5]
    for key in ("date", "time", "rangeStart", "rangeEnd"):
        validate_temporal(key, result[key])
    if result["rangeStart"] and result["rangeEnd"] and result["rangeStart"] >= result["rangeEnd"]:
        raise ValueError("Intervalo no válido")
    validate_target(result["target"])
    validate_changes(result["changes"])
    missing = result["missingFields"]
    allowed_missing = {"title", "date", "time", "location", "contactName", "phone", "target"}
    if missing is None:
        result["missingFields"] = []
    elif not isinstance(missing, list) or len(missing) > 7 or any(item not in allowed_missing for item in missing):
        raise ValueError("Campos pendientes no válidos")
    else:
        result["missingFields"] = list(dict.fromkeys(missing))
    if result["missingFields"] and not result["question"]:
        result["question"] = None
    if not result["missingFields"]:
        result["question"] = None
    if result["requiresConfirmation"] is None:
        result["requiresConfirmation"] = False
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
    if not isinstance(value, dict) or not set(value).issubset({"title", "date", "time"}) or not isinstance(value.get("title"), str):
        raise ValueError("Objetivo no válido")
    value["title"] = value["title"].strip()
    if not value["title"] or len(value["title"]) > MAX_TEXT_LENGTH:
        raise ValueError("Objetivo no válido")
    value["date"] = value.get("date")
    value["time"] = value.get("time")
    validate_temporal("date", value["date"])
    validate_temporal("time", value["time"])


def validate_changes(value: Any) -> None:
    if value is None:
        return
    allowed = {"title", "date", "time", "location", "notes"}
    if not isinstance(value, dict) or not value or not set(value).issubset(allowed):
        raise ValueError("Cambios no válidos")
    for key, item in value.items():
        if item is None:
            continue
        if key in {"date", "time"}:
            validate_temporal(key, item)
        elif not isinstance(item, str) or len(item) > MAX_TEXT_LENGTH:
            raise ValueError("Cambio de texto no válido")


def vertex_interpret(text: str, now: str, timezone: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    if not project:
        raise RuntimeError("Falta GOOGLE_CLOUD_PROJECT")
    from google import genai
    from google.genai import types

    client = genai.Client(
        vertexai=True,
        project=project,
        location=os.getenv("VERTEX_LOCATION", "global"),
        http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_SECONDS * 1000),
    )
    context_text = json.dumps(context, ensure_ascii=False) if context else "ninguno"
    prompt = f"Fecha/hora actual: {now}\nZona horaria: {timezone}\nCONTEXTO ACTIVO: {context_text}\nOrden actual: {text}"
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_json_schema=RESPONSE_SCHEMA,
            max_output_tokens=400,
        ),
    )
    return response.parsed if response.parsed is not None else json.loads(response.text)


def app(environ: dict[str, Any], start_response: Callable):
    origin = allowed_origin(environ)
    if environ.get("REQUEST_METHOD") == "OPTIONS":
        return cors_preflight_response(start_response, origin)
    path = environ.get("PATH_INFO")
    if environ.get("REQUEST_METHOD") != "POST" or path not in {"/interpret", "/session/status", "/oauth/exchange", "/google", "/media/upload", "/media/download", "/media/delete", "/test/session/status", "/test/oauth/exchange"}:
        return json_response(start_response, "404 Not Found", {"error": "No encontrado"}, origin)
    if environ.get("HTTP_ORIGIN") and not origin:
        return json_response(start_response, "403 Forbidden", {"error": "Origen no permitido"})
    try:
        subject = verify_identity(environ)
    except PermissionError as error:
        # No atribuir a Drive una sesión Firebase ausente, caducada o no
        # autorizada: antes ambos casos se traducían al mismo 401 de medios.
        if path.startswith("/media/"):
            print(f"media_identity_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
            return json_response(start_response, "401 Unauthorized", {"error": "La sesión de Angeli no está autorizada; inicia sesión de nuevo"}, origin)
        return json_response(start_response, "401 Unauthorized", {"error": "No autorizado"}, origin)
    try:
        enforce_rate_limit(subject)
        if path.startswith("/test/") and os.getenv("ANGELI_TEST_HARNESS_ENABLED") != "1":
            return json_response(start_response, "404 Not Found", {"error": "No encontrado"}, origin)
        if path == "/session/status":
            return json_response(start_response, "200 OK", session_status(), origin)
        if path == "/test/session/status":
            return json_response(start_response, "200 OK", test_session_status(), origin)
        if path == "/oauth/exchange":
            oauth_payload = parse_json_body(environ, {"integration", "code", "redirectUri"})
            integration, code, redirect_uri = oauth_payload.get("integration"), oauth_payload.get("code"), oauth_payload.get("redirectUri")
            if integration not in {CONTACTS, CALENDAR, DRIVE} or not isinstance(code, str) or not isinstance(redirect_uri, str) or redirect_uri not in configured_origins():
                raise ValueError("Autorización no válida")
            return json_response(start_response, "200 OK", sessions().exchange_code(integration, code, redirect_uri), origin)
        if path == "/test/oauth/exchange":
            oauth_payload = parse_json_body(environ, {"integration", "code", "redirectUri"})
            integration, code, redirect_uri = oauth_payload.get("integration"), oauth_payload.get("code"), oauth_payload.get("redirectUri")
            if integration not in {CONTACTS, CALENDAR, DRIVE} or not isinstance(code, str) or not isinstance(redirect_uri, str) or redirect_uri not in configured_origins():
                raise ValueError("Autorización no válida")
            return json_response(start_response, "200 OK", test_sessions().exchange_code(integration, code, redirect_uri), origin)
        if path == "/google":
            try:
                result = persistent_google_action(parse_json_body(environ, {"integration", "action", "query", "event", "eventId", "params"}))
            except PermissionError:
                return json_response(start_response, "401 Unauthorized", {"error": "Calendar no está autorizado; conéctalo de nuevo"}, origin)
            except RuntimeError:
                return json_response(start_response, "502 Bad Gateway", {"error": "Calendar no pudo completar la consulta"}, origin)
            return json_response(start_response, "200 OK", result, origin)
        if path == "/media/upload":
            data, name, mime_type, kind = parse_media_upload(environ)
            try:
                return json_response(start_response, "200 OK", sessions().upload_drive_file(data, name, mime_type, kind), origin)
            except PermissionError as error:
                print(f"media_drive_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
                return json_response(start_response, "401 Unauthorized", {"error": "Drive no está autorizado para escribir en la carpeta configurada"}, origin)
        if path == "/media/download":
            payload = parse_json_body(environ, {"fileId"})
            file_id = payload.get("fileId")
            if not isinstance(file_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id): raise ValueError("Archivo no válido")
            try:
                data, mime_type = sessions().download_drive_file(file_id)
            except PermissionError as error:
                print(f"media_drive_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
                return json_response(start_response, "401 Unauthorized", {"error": "Drive no puede leer este adjunto"}, origin)
            return media_response(start_response, data, mime_type, origin)
        if path == "/media/delete":
            payload = parse_json_body(environ, {"fileId"})
            file_id = payload.get("fileId")
            if not isinstance(file_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id): raise ValueError("Archivo no válido")
            try:
                sessions().delete_drive_file(file_id)
            except PermissionError as error:
                print(f"media_drive_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
                return json_response(start_response, "401 Unauthorized", {"error": "Drive no puede borrar este adjunto"}, origin)
            return json_response(start_response, "200 OK", {"deleted": True}, origin)
        text, now, timezone, context = parse_request(environ)
        interpreter = _interpreter or vertex_interpret
        try:
            raw = interpreter(text, now, timezone) if _interpreter else interpreter(text, now, timezone, context)
            interpretation = validate_interpretation(raw)
        except ValueError as error:
            raise OutputValidationError(str(error)) from error
        return json_response(start_response, "200 OK", interpretation, origin)
    except PermissionError:
        return json_response(start_response, "401 Unauthorized", {"error": "No autorizado"}, origin)
    except OutputValidationError as error:
        log_interpreter_error("invalid_model_output", error)
        return json_response(start_response, "503 Service Unavailable", {"error": "Interpretación no disponible"}, origin)
    except ValueError as error:
        print(f"request_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
        return json_response(start_response, "400 Bad Request", {"error": str(error)}, origin)
    except RuntimeError as error:
        if "Demasiadas" not in str(error):
            log_interpreter_error("runtime", error)
        return json_response(start_response, "429 Too Many Requests" if "Demasiadas" in str(error) else "503 Service Unavailable", {"error": "Interpretación no disponible"}, origin)
    except Exception as error:
        log_interpreter_error("unexpected", error)
        return json_response(start_response, "503 Service Unavailable", {"error": "Interpretación no disponible"}, origin)


def set_test_dependencies(interpreter: Callable[[str, str, str], dict[str, Any]] | None = None, verifier: Callable[[str], dict[str, Any]] | None = None, session_factory: Callable[[], GoogleSessions] | None = None) -> None:
    global _interpreter, _identity_verifier, _sessions_factory
    _interpreter, _identity_verifier, _sessions_factory = interpreter, verifier, session_factory


def wsgi_request(payload: dict[str, Any], authorization: str = "") -> tuple[str, dict[str, Any]]:
    """Ayuda exclusiva de pruebas locales; no se usa en Cloud Run."""
    body = json.dumps(payload).encode("utf-8")
    captured: dict[str, Any] = {}

    def start_response(status: str, headers: list[tuple[str, str]]):
        captured["status"], captured["headers"] = status, headers

    response = b"".join(app({"REQUEST_METHOD": "POST", "PATH_INFO": "/interpret", "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": authorization}, start_response))
    return captured["status"], json.loads(response)
