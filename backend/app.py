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
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from io import BytesIO
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from google_sessions import (
    CALENDAR,
    CONTACTS,
    DRIVE,
    GooglePermissionRequired,
    GoogleReconnectRequired,
    GoogleResourceNotFound,
    GoogleSessions,
)
from push_notifications import PushNotifications, verify_delivery_identity
from access_control import AccessControl, AccessDenied, QuotaExhausted
import mercadona_catalog

MAX_TEXT_LENGTH = 500
MAX_BODY_BYTES = 8_192  # 3ª auditoría: 2 KB no cabía un dictado largo con dos respuestas de seguimiento (400 y respaldo local justo en la aclaración).
MAX_MEDIA_BYTES = 20 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 8
RATE_LIMIT_PER_MINUTE = 30
VALID_INTENTS = {
    "note",
    "note.query",
    "task.create",
    "task.complete",
    "reminder.create",
    "reminder.query",
    "calendar.create",
    "calendar.query",
    "calendar.update",
    "calendar.delete",
    "contact.call",
    "whatsapp.compose",
    "file.store",
    "photo.store",
}
SENSITIVE_INTENTS = {"calendar.update", "calendar.delete", "contact.call", "whatsapp.compose"}
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
    "noteQuery",
    "noteClassification",
    "target",
    "changes",
    "linkedReminder",
    "requiresConfirmation",
    "missingFields",
    "question",
}

SYSTEM_INSTRUCTION = """Eres el intérprete de una secretaria personal en español.
Interpreta la orden actual usando la fecha, la hora local, el día de la semana
y el calendario de próximos días que se te dan; calcula «hoy», «mañana», «el
lunes», «este viernes» o «el día 20» SIEMPRE con ese calendario, nunca por tu
cuenta. Si hay una OPERACIÓN PENDIENTE, la orden actual normalmente es la
respuesta a esa operación: completa sus datos y conserva su intención. Pero si
la orden actual es por sí sola una orden completa de otro tipo (por ejemplo,
«¿qué tengo mañana?» o «apunta que…» mientras un evento espera la hora), usa la
intención nueva. Los AJUSTES DE NOTAS solo sirven para clasificar notas; no son
una operación pendiente.
Usa exclusivamente las intenciones permitidas por el esquema. Extrae solo datos
explícitos o inequívocos; no inventes fechas, horas, personas, teléfonos ni
ubicaciones. Si existe ambigüedad material sobre QUÉ quiere la persona, baja la
confianza. Que falte un dato (la hora, el mensaje, el contacto) NO es ambigüedad:
mantén la confianza alta (0.8 o más), deja ese campo en null, inclúyelo en
missingFields y formula la pregunta.
Formatos obligatorios: fechas «YYYY-MM-DD» y horas «HH:MM» en 24 horas, con dos
cifras («09:05», nunca «9:05»). En target, date y time son null si no se dicen.
Horas sin «de la mañana/tarde/noche»: para cenas, cenas de empresa, fiestas,
bodas, conciertos y quedadas por la tarde usa la hora de tarde o noche («cena a
las nueve» = 21:00); para reuniones, citas médicas y trámites usa el horario
laboral (08:00–20:00); si se da un día explícito, no elijas la hora según lo
cercana que esté a la hora actual. «A las doce» es mediodía salvo «de la noche».
En calendar.query, reminder.query y note.query usa SIEMPRE rangeStart y rangeEnd
cuando se habla de un periodo, también para un solo día: «¿qué tengo mañana?»
es rangeStart = mañana y rangeEnd = pasado mañana. «Pasado mañana» son DOS días
después de hoy. «En una semana» son 7 días, «en dos semanas» 14.
Una frase que describe algo que va a pasar («cena con Vicente el sábado»,
«reunión el lunes a las diez») es crear (calendar.create); solo es
calendar.update si pide explícitamente cambiar, mover, pasar o retrasar algo
que ya existe. «Toma nota», «apunta» y «anota» son siempre note.
En whatsapp.compose, si la frase ya incluye el mensaje (tras «que», «diciéndole»,
«dile», «preguntándole», «:»), notes contiene ese texto y NO se pregunta.
Para tareas pendientes («tengo que comprar pilas», «hay que llamar al seguro»)
sin fecha ni hora usa task.create; con fecha y hora, reminder.create.
Una fecha sin año que ya pasó este año se refiere al año siguiente al crear algo,
y a la pasada más reciente al preguntar por ella.

Para calendar.create, separa obligatoriamente los datos: title es un nombre
breve del evento, sin fecha, hora ni lugar; location es el recinto, dirección,
restaurante o población donde sucede el evento, conservando el lugar completo.
Elimina del título fórmulas administrativas como «está contratado» o
«contratada». Por ejemplo, «Está contratada discomóvil en Complejo San Marcos
de Gandía el 29 de agosto a las siete de la tarde» debe producir title
«Discomóvil» y location «Complejo San Marcos de Gandía». Si no se expresa un
lugar físico, location debe ser null.

Si una sola frase contiene un evento principal y además «recuérdame N días
antes ...», «avísame N días antes...» o «tienes que avisarme N días antes...»,
conserva calendar.create como intención principal y devuelve
linkedReminder con title, date y time del aviso anterior. La fecha del aviso se
calcula respecto a la fecha del evento y, si no se expresa otra hora para el
aviso, hereda la hora del evento. Ejemplo oficial: «Tenemos una boda el 14 de
septiembre a las seis en la Masía X. Recuérdame dos días antes comprobar el
equipo» produce el evento «Boda» en Masía X el día 14 a las 18:00 y un
linkedReminder «Comprobar el equipo» el día 12 a las 18:00. No reduzcas esta
orden compuesta a una nota ni pierdas uno de los dos elementos. El título del
aviso debe entenderse por sí solo fuera de Angeli e incluir el contexto del
evento y su ubicación cuando existan, por ejemplo «Comprobar el equipo de la
boda en Masía X».
Si la frase compuesta contiene el día pero no la hora, no la conviertas en
nota: conserva el evento, la ubicación y el aviso relativo, devuelve time null
también dentro de linkedReminder, marca únicamente time en missingFields y
pregunta a qué hora es el evento.

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
«cámbiame la hora con María», la palabra «hora» describe el campo que cambia:
target.title debe ser «María», nunca «hora con María». Aplica el mismo criterio
si el campo solicitado es la fecha, el día, el lugar, la ubicación o el título.
Para
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
Para preparar un mensaje de WhatsApp usa whatsapp.compose. contactName contiene
solo la persona destinataria y notes contiene únicamente el texto del mensaje,
sin fórmulas como «envía un WhatsApp a». Si falta la persona, incluye solo
contactName en missingFields; si falta el texto, incluye solo notes. Ejemplos:
«Envía un WhatsApp a Monse diciendo llego diez minutos tarde» produce
contactName «Monse» y notes «Llego diez minutos tarde»; «WhatsApp a Pepe»
pregunta «¿Qué mensaje quieres escribir?». Esta intención solo prepara el chat:
la aplicación nunca afirma que el mensaje se haya enviado.
Para reminder.create, si se dice una hora pero no un día, usa la fecha de hoy
cuando esa hora aún está por llegar; si ya pasó, usa el día siguiente. Las
expresiones relativas («en media hora», «dentro de dos horas», «en 10
minutos») se calculan sumando a la hora local actual.
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
Para crear una nota usa note. title debe ser un asunto breve y útil; notes puede
conservar el contexto o detalle si existe. Clasifica la nota sin bloquear su
creación. Si CONTEXTO ACTIVO incluye noteSettings, usa exactamente el id de una
de sus categories en noteClassification.scope y el id de uno de sus
relationTypes en relationType. «Anota/apunta/guarda en X» asigna la categoría X,
no una relación; «relaciona/vincula/asocia con X» sí expresa una relación. Sin
ajustes personalizados, scope es general, personal o company y relationType es
none, person, client, project o event. relationName identifica
esa relación cuando se expresa; purpose resume por qué se guarda, y tags
contiene como máximo cinco etiquetas breves. No inventes relaciones: si no se
expresan, usa scope general, relationType none, relationName null, purpose null
y tags []. Ejemplo: «Apunta para el proyecto Karaoke que debemos revisar el
precio de las licencias» es una nota con title «Precio de las licencias»,
scope company, relationType project, relationName «Karaoke» y purpose
«Revisar el precio».
Para consultar notas guardadas usa note.query. En noteQuery devuelve solamente
el asunto, persona, cliente, proyecto o etiqueta solicitados; si se piden todas
las notas, noteQuery debe ser null. Usa noteClassification solo para filtros
explícitos como «notas personales» o «notas de empresa». title debe ser null y
la consulta nunca crea una nota nueva.
Si faltan datos imprescindibles para calendar.create o reminder.create, indica
en missingFields los nombres de los campos que faltan (date, time, title,
location, contactName, phone, notes o target) y formula una única pregunta breve en
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
        "noteQuery": {"type": ["string", "null"]},
        "noteClassification": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["scope", "relationType", "relationName", "purpose", "tags"],
                    "properties": {
                        "scope": {"type": "string"},
                        "relationType": {"type": "string"},
                        "relationName": {"type": ["string", "null"]},
                        "purpose": {"type": ["string", "null"]},
                        "tags": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
                    },
                },
            ]
        },
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
                        # 3ª auditoría: era obligatorio y sin null, así que en
                        # «Cancela la cena con Vicente» o «Ya he llamado a
                        # Miguel» Gemini tenía que inventar una hora; con "" la
                        # respuesta entera se rechazaba (503 y respaldo local).
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
                        "time": {"type": ["string", "null"]},
                        "location": {"type": "string"},
                        "notes": {"type": "string"},
                    },
                },
            ]
        },
        "linkedReminder": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "date", "time", "notes"],
                    "properties": {
                        "title": {"type": "string"},
                        "date": {"type": "string"},
                        "time": {"type": ["string", "null"]},
                        "notes": {"type": ["string", "null"]},
                    },
                },
            ]
        },
        "requiresConfirmation": {"type": "boolean"},
        "missingFields": {"type": "array", "items": {"type": "string", "enum": ["title", "date", "time", "location", "contactName", "phone", "notes", "target"]}, "maxItems": 7},
        "question": {"type": ["string", "null"]},
    },
}

_rate_windows: dict[str, deque[float]] = defaultdict(deque)
_interpreter: Callable[[str, str, str], dict[str, Any]] | None = None
_chat_aside: Callable[[str], str] | None = None
_identity_verifier: Callable[[str], dict[str, Any]] | None = None
_sessions_factory: Callable[[], GoogleSessions] | None = None
_push_factory: Callable[[], PushNotifications] | None = None
_access_factory: Callable[[], AccessControl] | None = None
_mercadona_search: Callable[[str], list] | None = None
MERCADONA_SEARCH_LIMIT = 6
MERCADONA_SEARCH_MAX_LIMIT = 30


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
    if not isinstance(value, dict) or not set(value).issubset({"interactionId", "intent", "status", "collectedData", "missingFields", "question", "turns", "noteSettings"}):
        raise ValueError("Contexto conversacional no válido")
    note_settings = validate_note_settings(value.get("noteSettings")) if "noteSettings" in value else None
    if "interactionId" not in value:
        if set(value) != {"noteSettings"}:
            raise ValueError("Contexto conversacional no válido")
        return {"noteSettings": note_settings}
    interaction_id = value.get("interactionId")
    intent = value.get("intent")
    status = value.get("status")
    if not isinstance(interaction_id, str) or len(interaction_id) > 100 or intent not in VALID_INTENTS or status not in {"awaiting_input", "pending_confirmation", "executing"}:
        raise ValueError("Contexto conversacional no válido")
    collected = value.get("collectedData", {})
    if not isinstance(collected, dict):
        raise ValueError("Contexto conversacional no válido")
    # 3ª auditoría: el móvil guarda también noteQuery/noteClassification; en vez
    # de rechazar la petición entera (400 y respaldo local), se ignoran.
    collected = {key: item for key, item in collected.items() if key in {"title", "date", "time", "rangeStart", "rangeEnd", "location", "contactName", "phone", "notes", "target", "changes", "linkedReminder"}}
    missing = value.get("missingFields", [])
    if not isinstance(missing, list) or len(missing) > 7 or any(item not in {"title", "date", "time", "location", "contactName", "phone", "notes", "target"} for item in missing):
        raise ValueError("Contexto conversacional no válido")
    turns = value.get("turns", [])
    if not isinstance(turns, list) or len(turns) > 6:
        raise ValueError("Contexto conversacional no válido")
    safe_turns = []
    for turn in turns:
        if not isinstance(turn, dict) or set(turn) != {"role", "text"} or turn["role"] not in {"user", "assistant"} or not isinstance(turn["text"], str) or len(turn["text"]) > MAX_TEXT_LENGTH:
            raise ValueError("Contexto conversacional no válido")
        safe_turns.append({"role": turn["role"], "text": turn["text"]})
    result = {"interactionId": interaction_id, "intent": intent, "status": status, "collectedData": collected, "missingFields": missing, "question": value.get("question") if isinstance(value.get("question"), str) else None, "turns": safe_turns}
    if note_settings is not None:
        result["noteSettings"] = note_settings
    return result


def validate_note_settings(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"categories", "relationTypes"}:
        raise ValueError("Ajustes de notas no válidos")
    result = {}
    for key in ("categories", "relationTypes"):
        options = value[key]
        if not isinstance(options, list) or len(options) > 30:
            raise ValueError("Ajustes de notas no válidos")
        clean_options = []
        for option in options:
            if not isinstance(option, dict) or set(option) != {"id", "label"} or not isinstance(option["id"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", option["id"]) or not isinstance(option["label"], str) or not option["label"].strip() or len(option["label"]) > 80:
                raise ValueError("Ajustes de notas no válidos")
            clean_options.append({"id": option["id"], "label": option["label"].strip()})
        result[key] = clean_options
    return result


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
    with ThreadPoolExecutor(max_workers=3) as executor:
        pending = {integration: executor.submit(service.connection_status, integration) for integration in (CONTACTS, CALENDAR, DRIVE)}
        result = {integration: task.result() for integration, task in pending.items()}
    # Llegar aquí implica que Firebase autenticó al propietario y que el
    # backend de IA aceptó su sesión. No se consume una inferencia de Gemini
    # cada vez que se abre la PWA solo para mostrar este estado.
    return {"ai": {"state": "connected", "reason": "authenticated_backend"}, **result}


def test_session_status() -> dict[str, Any]:
    service = test_sessions()
    return {"contacts": service.connected(CONTACTS), "calendar": service.connected(CALENDAR), "drive": service.connected(DRIVE)}


def integration_error(error: Exception, integration: str) -> tuple[str, dict[str, str]]:
    labels = {CONTACTS: "Contactos", CALENDAR: "Calendar", DRIVE: "Drive"}
    label = labels.get(integration, "Google")
    if isinstance(error, GoogleReconnectRequired):
        return "401 Unauthorized", {
            "error": f"{label} necesita volver a conectarse",
            "code": "reconnect_required", "integration": integration,
        }
    if isinstance(error, GooglePermissionRequired):
        return "403 Forbidden", {
            "error": f"{label} no tiene los permisos necesarios; vuelve a conectarlo",
            "code": "permission_required", "integration": integration,
        }
    return "502 Bad Gateway", {
        "error": f"{label} no está disponible temporalmente",
        "code": "integration_unavailable", "integration": integration,
    }


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
        # Borrar un evento que el usuario ya quitó a mano en Calendar (o que ya
        # se había borrado antes desde Angeli) devolvía 404/410 y el cliente lo
        # trataba como fallo real, dejando el aviso/recordatorio atascado para
        # siempre (completar o cancelar volvía a chocar con el mismo evento ya
        # inexistente). Un delete que ya no encuentra el recurso es éxito: el
        # estado deseado (evento fuera de Calendar) ya se cumple.
        try:
            return {"calendarId": calendar_id, **service.api(CALENDAR, "DELETE", url)}
        except GoogleResourceNotFound:
            return {"calendarId": calendar_id, "eventId": event_id, "alreadyDeleted": True}
    if action == "patch" and isinstance(payload.get("event"), dict):
        return {"calendarId": calendar_id, **service.api(CALENDAR, "PATCH", url, payload["event"])}
    raise ValueError("Acción no válida")


def authenticate(environ: dict[str, Any]) -> dict[str, Any]:
    """Verifica solo *quién* es (token válido), sin decidir si tiene acceso.

    Separado de la autorización para que /access/status pueda responder a una
    cuenta identificada pero aún no invitada ("pide que te den de alta") en lugar
    de rechazarla con un 401 indistinguible de una sesión caducada.
    """
    if os.getenv("ANGELI_AI_DEV_BYPASS_AUTH") == "1" and not os.getenv("K_SERVICE"):
        return {"uid": "local-test-user", "email": "local-test-user@angeli", "email_verified": True, "bypass": True}
    token = environ.get("HTTP_AUTHORIZATION", "").removeprefix("Bearer ").strip()
    if not token:
        raise PermissionError("Falta identificación")
    verifier = _identity_verifier or firebase_identity_verifier
    return verifier(token)


def authorize(claims: dict[str, Any]) -> str:
    """Aplica la invitación (propietario, lista heredada o Firestore) y devuelve el uid."""
    access_control().authorize(claims)
    return str(claims.get("uid") or claims.get("sub") or "")


def verify_identity(environ: dict[str, Any]) -> str:
    return authorize(authenticate(environ))


def access_control() -> AccessControl:
    return _access_factory() if _access_factory else AccessControl()


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


def push_notifications() -> PushNotifications:
    return _push_factory() if _push_factory else PushNotifications()


def normalize_clock(value: Any) -> Any:
    """Corrige formatos de hora habituales en vez de rechazar toda la respuesta.

    3ª auditoría: «9:00» (sin cero), «21:30:00» o "" tumbaban la respuesta entera
    con un 503 y el móvil caía a reglas locales mucho peores.
    """
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        match = re.fullmatch(r"(\d{1,2}):([0-5]\d)(?::00)?", value)
        if match and int(match.group(1)) <= 23:
            return f"{int(match.group(1)):02d}:{match.group(2)}"
    return value


def normalize_day(value: Any) -> Any:
    return None if isinstance(value, str) and not value.strip() else value


def slug_id(value: Any) -> Any:
    """«Empresa» -> «empresa», «Proyecto Karaoke» -> «proyecto-karaoke»."""
    if not isinstance(value, str):
        return value
    import unicodedata
    plain = "".join(ch for ch in unicodedata.normalize("NFD", value.strip().lower()) if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:64] or value


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
    if result["intent"] != "calendar.create":
        result["linkedReminder"] = None
    # 3ª auditoría: «¿Qué apunté ayer?» o «¿Qué recordatorios tengo esta
    # semana?» necesitan su intervalo; antes solo se conservaba en la agenda y
    # la consulta devolvía TODO.
    if result["intent"] not in {"calendar.query", "note.query", "reminder.query"}:
        result["rangeStart"] = None
        result["rangeEnd"] = None
    if result["intent"] == "calendar.query":
        # Una pregunta de agenda se resuelve por intervalo, no con sus
        # propias palabras como filtro de título de Calendar.
        result["title"] = None
    if result["intent"] != "note.query":
        result["noteQuery"] = None
    else:
        result["title"] = None
    if result["intent"] not in {"note", "note.query"}:
        result["noteClassification"] = None
    for key in ("title", "location", "contactName", "phone", "notes", "noteQuery", "question"):
        value = result[key]
        if value is not None and (not isinstance(value, str) or len(value) > MAX_TEXT_LENGTH):
            raise ValueError("Texto de salida no válido")
        result[key] = value.strip() if isinstance(value, str) else None
    # Gemini puede incluir segundos cero: no cambian la hora del contrato HH:MM.
    # No truncar segundos reales ni convertir horas fuera de rango.
    result["time"] = normalize_clock(result["time"])
    for key in ("date", "rangeStart", "rangeEnd"):
        result[key] = normalize_day(result[key])
    for key in ("date", "time", "rangeStart", "rangeEnd"):
        validate_temporal(key, result[key])
    # 3ª auditoría: «¿Qué tengo hoy?» con inicio y fin iguales (el modelo no
    # siempre respeta el fin exclusivo) daba 503; se amplía a un día.
    # Examen del intérprete: en las consultas de UN día Gemini suele devolver
    # `date` en vez de intervalo, y la app no usa `date` en una consulta: buscaba
    # de hoy a 90 días («¿Qué tengo mañana?» enseñaba todo el trimestre).
    if result["intent"] in {"calendar.query", "note.query", "reminder.query"} and result["date"] and not result["rangeStart"]:
        result["rangeStart"] = result["date"]
        result["rangeEnd"] = (date.fromisoformat(result["date"]) + timedelta(days=1)).isoformat()
    if result["rangeStart"] and not result["rangeEnd"]:
        result["rangeEnd"] = (date.fromisoformat(result["rangeStart"]) + timedelta(days=1)).isoformat()
    if result["rangeStart"] and result["rangeEnd"] and result["rangeStart"] == result["rangeEnd"]:
        result["rangeEnd"] = (date.fromisoformat(result["rangeEnd"]) + timedelta(days=1)).isoformat()
    if result["rangeStart"] and result["rangeEnd"] and result["rangeStart"] > result["rangeEnd"]:
        raise ValueError("Intervalo no válido")
    if isinstance(result["changes"], dict):
        result["changes"] = {key: (normalize_clock(item) if key == "time" else normalize_day(item) if key == "date" else item) for key, item in result["changes"].items()}
        if not any(item is not None for item in result["changes"].values()):
            result["changes"] = None
    if isinstance(result["linkedReminder"], dict):
        result["linkedReminder"]["time"] = normalize_clock(result["linkedReminder"].get("time"))
        result["linkedReminder"]["date"] = normalize_day(result["linkedReminder"].get("date"))
        try:
            validate_linked_reminder(result["linkedReminder"])
        except ValueError:
            result["linkedReminder"] = None
    if isinstance(result["noteClassification"], dict):
        classification = result["noteClassification"]
        for key in ("scope", "relationType"):
            classification[key] = slug_id(classification.get(key))
        if isinstance(classification.get("tags"), list):
            classification["tags"] = [tag for tag in classification["tags"] if isinstance(tag, str) and tag.strip()][:5]
    validate_target(result["target"])
    validate_changes(result["changes"])
    validate_linked_reminder(result["linkedReminder"])
    validate_note_classification(result["noteClassification"])
    missing = result["missingFields"]
    allowed_missing = {"title", "date", "time", "location", "contactName", "phone", "notes", "target"}
    if missing is None:
        result["missingFields"] = []
    elif not isinstance(missing, list):
        raise ValueError("Campos pendientes no válidos")
    else:
        # 3ª auditoría: un campo pendiente desconocido («message», «question»)
        # ya no tira toda la respuesta; se descarta solo ese.
        result["missingFields"] = list(dict.fromkeys(item for item in missing if item in allowed_missing))[:7]
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


def validate_note_classification(value: Any) -> None:
    if value is None:
        return
    required = {"scope", "relationType", "relationName", "purpose", "tags"}
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("Clasificación de nota no válida")
    if not isinstance(value["scope"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", value["scope"]) or not isinstance(value["relationType"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", value["relationType"]):
        raise ValueError("Clasificación de nota no válida")
    for key in ("relationName", "purpose"):
        item = value[key]
        if item is not None and (not isinstance(item, str) or len(item) > MAX_TEXT_LENGTH):
            raise ValueError("Clasificación de nota no válida")
        value[key] = item.strip() if isinstance(item, str) and item.strip() else None
    tags = value["tags"]
    if not isinstance(tags, list) or len(tags) > 5 or any(not isinstance(tag, str) or not tag.strip() or len(tag) > 60 for tag in tags):
        raise ValueError("Etiquetas de nota no válidas")
    value["tags"] = list(dict.fromkeys(tag.strip() for tag in tags))
    if value["relationType"] == "none":
        value["relationName"] = None


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
    value["date"] = normalize_day(value.get("date"))
    value["time"] = normalize_clock(value.get("time"))
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


def validate_linked_reminder(value: Any) -> None:
    if value is None:
        return
    allowed = {"title", "date", "time", "notes"}
    if not isinstance(value, dict) or set(value) != allowed:
        raise ValueError("Aviso vinculado no válido")
    if not isinstance(value["title"], str) or not value["title"].strip() or len(value["title"]) > MAX_TEXT_LENGTH:
        raise ValueError("Título del aviso vinculado no válido")
    value["title"] = value["title"].strip()
    if value["notes"] is not None and (not isinstance(value["notes"], str) or len(value["notes"]) > MAX_TEXT_LENGTH):
        raise ValueError("Descripción del aviso vinculado no válida")
    validate_temporal("date", value["date"])
    validate_temporal("time", value["time"])


# Examen del intérprete (backend/eval, 140 frases genéricas): con el mismo prompt,
# 2.5 Flash sin razonamiento acierta 98 % frente a 94 % de Flash-Lite (87 %
# antes de mejorar el prompt), con ~0,5 s más. El razonamiento no mejora la nota
# y gasta el margen de salida (respuestas cortadas), así que va a 0.
INTERPRETER_MODEL = "gemini-2.5-flash"
INTERPRETER_THINKING_BUDGET = 0
# La frase corta de reacción del modo conversación no necesita más: rápida y barata.
ASIDE_MODEL = "gemini-2.5-flash-lite"
# El prompt de sistema pesa ~48.000 caracteres (~12.000-13.000 tokens) y es
# idéntico en cada interpretación. Sin caché, ese texto entero se transmite y
# se factura completo en cada llamada. Vertex AI permite cachearlo de forma
# explícita (client.caches) y reutilizar esa caché por su nombre en vez de
# reenviar el texto. Se refresca un margen antes de su vencimiento real para
# no depender del reintento de emergencia en el caso normal.
_INTERPRETER_CACHE_TTL_SECONDS = 3600
_INTERPRETER_CACHE_REFRESH_MARGIN_SECONDS = 60
_interpreter_cache_name: str | None = None
_interpreter_cache_expires_at: float = 0.0


def _cached_system_instruction(client: Any) -> str | None:
    """Crea (o reutiliza) la caché de Vertex AI con SYSTEM_INSTRUCTION.

    Devuelve None si la caché no se pudo crear; en ese caso la llamada debe
    seguir funcionando enviando system_instruction inline, como antes de
    tener caché — esta función nunca debe ser la causa de que falle una
    interpretación.
    """
    global _interpreter_cache_name, _interpreter_cache_expires_at
    now = time.monotonic()
    if _interpreter_cache_name and now < _interpreter_cache_expires_at:
        return _interpreter_cache_name
    from google.genai import types

    try:
        cache = client.caches.create(
            model=INTERPRETER_MODEL,
            config=types.CreateCachedContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                ttl=f"{_INTERPRETER_CACHE_TTL_SECONDS}s",
                display_name="angeli-interpreter-system",
            ),
        )
    except Exception as error:  # noqa: BLE001 - cualquier fallo aquí solo desactiva la caché
        log_interpreter_error("cache_create_failed", error)
        _interpreter_cache_name = None
        return None
    _interpreter_cache_name = cache.name
    _interpreter_cache_expires_at = now + _INTERPRETER_CACHE_TTL_SECONDS - _INTERPRETER_CACHE_REFRESH_MARGIN_SECONDS
    return _interpreter_cache_name


WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def interpreter_prompt(text: str, now: str, timezone: str, context: dict[str, Any] | None = None) -> str:
    """Prompt de usuario con la hora LOCAL, el día de la semana y un calendario.

    3ª auditoría: se enviaba la hora en UTC y sin día de la semana; flash-lite
    tenía que convertir la zona y deducir el día por su cuenta, y fallaba entre
    las 00:00 y las 02:00 y con «el jueves», «el lunes que viene» o «en media
    hora». Además los ajustes de notas llegaban como «CONTEXTO ACTIVO», que el
    prompt trata como operación pendiente, y sesgaban toda orden nueva.
    """
    try:
        zone = ZoneInfo(timezone)
        local = datetime.fromisoformat(now).astimezone(zone)
    except (ValueError, KeyError):
        local = datetime.fromisoformat(now)
    today = local.date()
    calendar_lines = ", ".join(f"{WEEKDAYS_ES[(today + timedelta(days=offset)).weekday()]} {(today + timedelta(days=offset)).isoformat()}" for offset in range(15))
    context = dict(context or {})
    note_settings = context.pop("noteSettings", None)
    pending = json.dumps(context, ensure_ascii=False) if context.get("interactionId") else "ninguna"
    settings = json.dumps(note_settings, ensure_ascii=False) if note_settings else "ninguno"
    return (
        f"Ahora (hora local): {WEEKDAYS_ES[local.weekday()]} {local.strftime('%Y-%m-%d %H:%M')} ({timezone})\n"
        f"Próximos días: {calendar_lines}\n"
        f"OPERACIÓN PENDIENTE: {pending}\n"
        f"AJUSTES DE NOTAS: {settings}\n"
        f"Orden actual: {text}"
    )


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
    prompt = interpreter_prompt(text, now, timezone, context)

    cache_name = _cached_system_instruction(client)
    if cache_name:
        try:
            response = client.models.generate_content(
                model=INTERPRETER_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    cached_content=cache_name,
                    response_mime_type="application/json",
                    response_json_schema=RESPONSE_SCHEMA,
                    temperature=0,
                    max_output_tokens=800,
                    thinking_config=types.ThinkingConfig(thinking_budget=INTERPRETER_THINKING_BUDGET),
                ),
            )
            return response.parsed if response.parsed is not None else json.loads(response.text)
        except Exception as error:  # noqa: BLE001 - la caché pudo caducar o borrarse entre medias
            log_interpreter_error("cache_generate_failed", error)
            global _interpreter_cache_name
            _interpreter_cache_name = None

    # Sin caché disponible (no se pudo crear, o falló justo al usarla):
    # mismo comportamiento que antes de tener caché, enviando el prompt de
    # sistema completo en la propia llamada.
    response = client.models.generate_content(
        model=INTERPRETER_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_json_schema=RESPONSE_SCHEMA,
            # 3ª auditoría: sin fijar, Gemini usa 1.0 y la misma frase se
            # interpretaba distinto cada vez. Clasificar y extraer pide 0.
            temperature=0,
            # 400 se quedaba justo con una nota larga + clasificación: JSON
            # cortado = 503.
            max_output_tokens=800,
            thinking_config=types.ThinkingConfig(thinking_budget=INTERPRETER_THINKING_BUDGET),
        ),
    )
    return response.parsed if response.parsed is not None else json.loads(response.text)


# Módulo aparte, deliberadamente desacoplado de vertex_interpret: no comparte
# prompt, esquema de respuesta ni caché. Sirve solo una frase corta y variada
# de reacción ("aparte conversacional") mientras la orden real se procesa; no
# decide ni ejecuta ninguna acción, así que un fallo o una respuesta rara aquí
# nunca puede alterar una nota, recordatorio o evento. Si esta función falla
# por cualquier motivo, el llamador (endpoint /chat/aside) simplemente
# devuelve error y el frontend cae a su propia lista de frases fijas.
ASIDE_SYSTEM_INSTRUCTION = (
    "Eres Angeli, una secretaria personal cercana y con sentido del humor, "
    "en español de España. Te acaban de pedir algo por voz y todavía lo "
    "estás procesando. Responde SOLO con una reacción muy breve (máximo 6 "
    "palabras), natural y variada, tipo compañera de trabajo simpática. "
    "Nunca dos veces la misma. No repitas ni resumas la petición, no la "
    "cumplas todavía, no hagas preguntas, no uses comillas ni emoji."
)
ASIDE_MAX_OUTPUT_TOKENS = 20


def vertex_chat_aside(text: str) -> str:
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
    response = client.models.generate_content(
        model=ASIDE_MODEL,
        contents=f"Orden que estás procesando: {text}",
        config=types.GenerateContentConfig(
            system_instruction=ASIDE_SYSTEM_INSTRUCTION,
            max_output_tokens=ASIDE_MAX_OUTPUT_TOKENS,
        ),
    )
    reply = (response.text or "").strip()
    if not reply or len(reply) > 120:
        raise ValueError("Respuesta de aside no válida")
    return reply


def app(environ: dict[str, Any], start_response: Callable):
    origin = allowed_origin(environ)
    if environ.get("REQUEST_METHOD") == "OPTIONS":
        return cors_preflight_response(start_response, origin)
    path = environ.get("PATH_INFO")
    routes = {"/interpret", "/chat/aside", "/shopping/mercadona/search", "/access/status", "/session/status", "/oauth/exchange", "/google", "/media/upload", "/media/download", "/media/delete", "/push/register", "/push/unregister", "/push/schedule", "/push/cancel", "/push/test", "/push/deliver", "/test/session/status", "/test/oauth/exchange"}
    if environ.get("REQUEST_METHOD") != "POST" or path not in routes:
        return json_response(start_response, "404 Not Found", {"error": "No encontrado"}, origin)
    if environ.get("HTTP_ORIGIN") and not origin:
        return json_response(start_response, "403 Forbidden", {"error": "Origen no permitido"})
    try:
        if path == "/push/deliver":
            service = push_notifications()
            verify_delivery_identity(environ, service.delivery_account, service.delivery_url.rsplit("/push/deliver", 1)[0])
            delivery = parse_json_body(environ, {"uid", "entryId", "dueAt", "generation", "kind"})
            uid, entry_id, due_at, generation, kind = delivery.get("uid"), delivery.get("entryId"), delivery.get("dueAt"), delivery.get("generation"), delivery.get("kind")
            if not isinstance(uid, str) or not uid or not isinstance(entry_id, str) or not entry_id or not isinstance(due_at, str) or not isinstance(generation, str) or kind not in {"before", "at", "after"}:
                raise ValueError("Entrega no válida")
            return json_response(start_response, "200 OK", service.deliver(uid, entry_id, due_at, generation, kind), origin)
        claims = authenticate(environ)
        # El estado de acceso se responde a cualquier cuenta identificada, aunque
        # todavía no esté invitada, para que el cliente pueda mostrar "pide que te
        # den de alta" en vez de un error de sesión.
        if path == "/access/status":
            return json_response(start_response, "200 OK", access_control().status(claims), origin)
        subject = authorize(claims)
    except PermissionError as error:
        if "Usuario no autorizado" in str(error):
            return json_response(start_response, "401 Unauthorized", {"error": "Esta cuenta no está autorizada para Angeli", "code": "account_not_allowed", "integration": "ai"}, origin)
        # No atribuir a Drive una sesión Firebase ausente, caducada o no
        # autorizada: antes ambos casos se traducían al mismo 401 de medios.
        if path.startswith("/media/"):
            print(f"media_identity_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
            return json_response(start_response, "401 Unauthorized", {"error": "La sesión de Angeli no está autorizada; inicia sesión de nuevo", "code": "session_required", "integration": "ai"}, origin)
        return json_response(start_response, "401 Unauthorized", {"error": "La sesión de Angeli necesita volver a iniciarse", "code": "session_required", "integration": "ai"}, origin)
    try:
        enforce_rate_limit(subject)
        # Las rutas que gastan IA cobran una interacción al cupo mensual antes de
        # trabajar; el propietario y la lista heredada no gastan, y quien tenga el
        # grifo abierto cuenta pero no se corta.
        # 3ª auditoría: antes se cobraba al ENTRAR y en tres rutas, así que un
        # 503 de la IA, una petición mal formada, cada búsqueda en Mercadona
        # (que no usa IA) y la frase de reacción del modo conversación (que el
        # móvil descarta a los 900 ms) gastaban cupo. Un invitado podía agotar
        # su mes en una sola sesión de compra. Ahora solo /interpret consume, y
        # solo tras una interpretación válida; antes solo se comprueba.
        if path == "/interpret":
            access_control().ensure_quota(claims)
        if path.startswith("/test/") and os.getenv("ANGELI_TEST_HARNESS_ENABLED") != "1":
            return json_response(start_response, "404 Not Found", {"error": "No encontrado"}, origin)
        if path == "/session/status":
            return json_response(start_response, "200 OK", session_status(), origin)
        if path == "/push/register":
            payload = parse_json_body(environ, {"token", "label"})
            return json_response(start_response, "200 OK", push_notifications().register(subject, payload.get("token"), payload.get("label") or "Dispositivo"), origin)
        if path == "/push/unregister":
            payload = parse_json_body(environ, {"token"})
            return json_response(start_response, "200 OK", push_notifications().unregister(subject, payload.get("token")), origin)
        if path == "/push/schedule":
            payload = parse_json_body(environ, {"entryId", "dueAt"})
            return json_response(start_response, "200 OK", push_notifications().schedule(subject, payload.get("entryId"), payload.get("dueAt")), origin)
        if path == "/push/cancel":
            payload = parse_json_body(environ, {"entryId"})
            return json_response(start_response, "200 OK", push_notifications().cancel(subject, payload.get("entryId")), origin)
        if path == "/push/test":
            payload = parse_json_body(environ, {"token"})
            return json_response(start_response, "200 OK", push_notifications().send_test(subject, payload.get("token")), origin)
        if path == "/test/session/status":
            return json_response(start_response, "200 OK", test_session_status(), origin)
        if path == "/oauth/exchange":
            oauth_payload = parse_json_body(environ, {"integration", "code", "redirectUri"})
            integration, code, redirect_uri = oauth_payload.get("integration"), oauth_payload.get("code"), oauth_payload.get("redirectUri")
            if integration not in {CONTACTS, CALENDAR, DRIVE} or not isinstance(code, str) or not isinstance(redirect_uri, str) or redirect_uri not in configured_origins():
                raise ValueError("Autorización no válida")
            try:
                result = sessions().exchange_code(integration, code, redirect_uri)
            except (GoogleReconnectRequired, GooglePermissionRequired, RuntimeError) as error:
                status, payload = integration_error(error, integration)
                return json_response(start_response, status, payload, origin)
            return json_response(start_response, "200 OK", result, origin)
        if path == "/test/oauth/exchange":
            oauth_payload = parse_json_body(environ, {"integration", "code", "redirectUri"})
            integration, code, redirect_uri = oauth_payload.get("integration"), oauth_payload.get("code"), oauth_payload.get("redirectUri")
            if integration not in {CONTACTS, CALENDAR, DRIVE} or not isinstance(code, str) or not isinstance(redirect_uri, str) or redirect_uri not in configured_origins():
                raise ValueError("Autorización no válida")
            return json_response(start_response, "200 OK", test_sessions().exchange_code(integration, code, redirect_uri), origin)
        if path == "/google":
            google_payload = parse_json_body(environ, {"integration", "action", "query", "event", "eventId", "params"})
            integration = google_payload.get("integration")
            try:
                result = persistent_google_action(google_payload)
            except (GoogleReconnectRequired, GooglePermissionRequired, RuntimeError) as error:
                status, payload = integration_error(error, integration)
                return json_response(start_response, status, payload, origin)
            return json_response(start_response, "200 OK", result, origin)
        if path == "/media/upload":
            data, name, mime_type, kind = parse_media_upload(environ)
            try:
                return json_response(start_response, "200 OK", sessions().upload_drive_file(data, name, mime_type, kind), origin)
            except (GoogleReconnectRequired, GooglePermissionRequired, RuntimeError) as error:
                print(f"media_drive_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
                status, payload = integration_error(error, DRIVE)
                return json_response(start_response, status, payload, origin)
        if path == "/media/download":
            payload = parse_json_body(environ, {"fileId"})
            file_id = payload.get("fileId")
            if not isinstance(file_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id): raise ValueError("Archivo no válido")
            try:
                data, mime_type = sessions().download_drive_file(file_id)
            except (GoogleReconnectRequired, GooglePermissionRequired, RuntimeError) as error:
                print(f"media_drive_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
                status, payload = integration_error(error, DRIVE)
                return json_response(start_response, status, payload, origin)
            return media_response(start_response, data, mime_type, origin)
        if path == "/media/delete":
            payload = parse_json_body(environ, {"fileId"})
            file_id = payload.get("fileId")
            if not isinstance(file_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id): raise ValueError("Archivo no válido")
            try:
                sessions().delete_drive_file(file_id)
            except (GoogleReconnectRequired, GooglePermissionRequired, RuntimeError) as error:
                print(f"media_drive_error path={path} reason={str(error)}", file=sys.stderr, flush=True)
                status, payload = integration_error(error, DRIVE)
                return json_response(start_response, status, payload, origin)
            return json_response(start_response, "200 OK", {"deleted": True}, origin)
        if path == "/chat/aside":
            aside_payload = parse_json_body(environ, {"text"})
            aside_text = aside_payload.get("text")
            if not isinstance(aside_text, str) or not aside_text.strip() or len(aside_text) > MAX_TEXT_LENGTH:
                raise ValueError("El texto debe tener entre 1 y 500 caracteres")
            aside = _chat_aside or vertex_chat_aside
            try:
                reply = aside(aside_text.strip())
            except ValueError as error:
                raise OutputValidationError(str(error)) from error
            return json_response(start_response, "200 OK", {"reply": reply}, origin)
        if path == "/shopping/mercadona/search":
            search_payload = parse_json_body(environ, {"query", "limit"})
            search_query = search_payload.get("query")
            if not isinstance(search_query, str) or not search_query.strip() or len(search_query) > MAX_TEXT_LENGTH:
                raise ValueError("La búsqueda debe tener entre 1 y 500 caracteres")
            requested_limit = search_payload.get("limit", MERCADONA_SEARCH_LIMIT)
            if not isinstance(requested_limit, int) or isinstance(requested_limit, bool):
                raise ValueError("El límite de resultados no es válido")
            search_limit = max(1, min(requested_limit, MERCADONA_SEARCH_MAX_LIMIT))
            search = _mercadona_search or mercadona_catalog.search
            try:
                results = search(search_query.strip(), search_limit)
            except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
                raise RuntimeError("El catálogo de Mercadona no está disponible ahora mismo") from error
            return json_response(start_response, "200 OK", {"results": results}, origin)
        text, now, timezone, context = parse_request(environ)
        interpreter = _interpreter or vertex_interpret
        try:
            raw = interpreter(text, now, timezone) if _interpreter else interpreter(text, now, timezone, context)
            interpretation = validate_interpretation(raw)
        except ValueError as error:
            raise OutputValidationError(str(error)) from error
        access_control().consume(claims)
        return json_response(start_response, "200 OK", interpretation, origin)
    except PermissionError:
        return json_response(start_response, "401 Unauthorized", {"error": "No autorizado"}, origin)
    except QuotaExhausted:
        return json_response(start_response, "429 Too Many Requests", {"error": "Se agotó tu prueba de Angeli. Para seguir, pon tu propia IA en Ajustes o pide más.", "code": "quota_exhausted", "integration": "ai"}, origin)
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


def set_test_dependencies(interpreter: Callable[[str, str, str], dict[str, Any]] | None = None, verifier: Callable[[str], dict[str, Any]] | None = None, session_factory: Callable[[], GoogleSessions] | None = None, push_factory: Callable[[], PushNotifications] | None = None, chat_aside: Callable[[str], str] | None = None, mercadona_search: Callable[[str, int], list] | None = None, access_factory: Callable[[], AccessControl] | None = None) -> None:
    global _interpreter, _identity_verifier, _sessions_factory, _push_factory, _chat_aside, _mercadona_search, _access_factory
    _interpreter, _identity_verifier, _sessions_factory, _push_factory, _chat_aside, _mercadona_search = interpreter, verifier, session_factory, push_factory, chat_aside, mercadona_search
    _access_factory = access_factory


def wsgi_request(payload: dict[str, Any], authorization: str = "") -> tuple[str, dict[str, Any]]:
    """Ayuda exclusiva de pruebas locales; no se usa en Cloud Run."""
    body = json.dumps(payload).encode("utf-8")
    captured: dict[str, Any] = {}

    def start_response(status: str, headers: list[tuple[str, str]]):
        captured["status"], captured["headers"] = status, headers

    response = b"".join(app({"REQUEST_METHOD": "POST", "PATH_INFO": "/interpret", "CONTENT_LENGTH": str(len(body)), "wsgi.input": BytesIO(body), "HTTP_AUTHORIZATION": authorization}, start_response))
    return captured["status"], json.loads(response)
