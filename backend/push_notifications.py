"""Programación y entrega de avisos propios de la PWA de Angeli."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any


def _firebase_app():
    import firebase_admin

    try:
        return firebase_admin.get_app()
    except ValueError:
        return firebase_admin.initialize_app(options={"projectId": os.environ["GOOGLE_CLOUD_PROJECT"]})


class PushNotifications:
    def __init__(self) -> None:
        project = os.environ["GOOGLE_CLOUD_PROJECT"]
        self.project = project
        self.database = os.getenv("ANGELI_FIRESTORE_DATABASE", "angelifirebase")
        self.location = os.getenv("ANGELI_PUSH_QUEUE_LOCATION", "europe-west1")
        self.queue = os.getenv("ANGELI_PUSH_QUEUE", "angeli-reminders")
        self.delivery_url = os.getenv(
            "ANGELI_PUSH_DELIVERY_URL",
            "https://angeli-ai-interpreter-172772694205.europe-southwest1.run.app/push/deliver",
        )
        self.delivery_account = os.getenv(
            "ANGELI_PUSH_DELIVERY_SERVICE_ACCOUNT",
            "angeli-notification-delivery@angeli-secretaria.iam.gserviceaccount.com",
        )

    def _db(self):
        from firebase_admin import firestore

        return firestore.client(app=_firebase_app(), database_id=self.database)

    def _tasks(self):
        from google.cloud import tasks_v2

        return tasks_v2.CloudTasksClient()

    def _task_name(self, uid: str, entry_id: str, generation: str, kind: str) -> str:
        digest = hashlib.sha256(f"{uid}:{entry_id}:{generation}:{kind}".encode()).hexdigest()[:40]
        return self._tasks().task_path(self.project, self.location, self.queue, f"reminder-{digest}")

    def _reminder_ref(self, uid: str, entry_id: str):
        return self._db().collection("users").document(uid).collection("pushReminders").document(entry_id)

    @staticmethod
    def _not_found(error: Exception) -> bool:
        code = getattr(error, "code", lambda: None)()
        return getattr(code, "name", "") == "NOT_FOUND" or type(error).__name__ == "NotFound"

    def register(self, uid: str, token: str, label: str = "Dispositivo") -> dict[str, Any]:
        if not isinstance(token, str) or not 40 <= len(token) <= 4096:
            raise ValueError("Dispositivo no válido")
        token_id = hashlib.sha256(token.encode()).hexdigest()
        self._db().collection("users").document(uid).collection("pushDevices").document(token_id).set({
            "token": token,
            "label": str(label or "Dispositivo")[:80],
            "updatedAt": datetime.now(timezone.utc),
        })
        return {"registered": True}

    def unregister(self, uid: str, token: str) -> dict[str, Any]:
        if not isinstance(token, str) or not token:
            raise ValueError("Dispositivo no válido")
        token_id = hashlib.sha256(token.encode()).hexdigest()
        self._db().collection("users").document(uid).collection("pushDevices").document(token_id).delete()
        return {"unregistered": True}

    def _settings(self, uid: str) -> dict[str, Any]:
        snapshot = self._db().collection("users").document(uid).collection("settings").document("notifications").get()
        value = snapshot.to_dict() if snapshot.exists else {}
        types = value.get("types") or {}
        quiet = value.get("quiet") or {}
        def minutes(key: str, default: int) -> int:
            try:
                return max(0, min(10080, int(value[key] if key in value else default)))
            except (TypeError, ValueError):
                return default
        return {
            "atTime": value.get("atTime") is not False,
            "beforeMinutes": minutes("beforeMinutes", 0),
            "afterMinutes": minutes("afterMinutes", 60),
            "types": {"reminders": types.get("reminders") is not False, "calls": types.get("calls") is not False,
                      "linked": types.get("linked") is not False, "tasks": types.get("tasks") is not False,
                      "events": types.get("events") is True},
            "quiet": {"enabled": quiet.get("enabled") is not False, "start": quiet.get("start") or "22:30",
                      "end": quiet.get("end") or "08:00", "deliverAfter": quiet.get("deliverAfter") is not False},
        }

    @staticmethod
    def _entry_type(entry: dict[str, Any]) -> str:
        schedule = entry.get("schedule") or {}
        if schedule.get("relatedEventId"):
            return "linked"
        if entry.get("type") == "contact" or (entry.get("aiIntent") or {}).get("intent") == "contact.call":
            return "calls"
        if entry.get("type") == "task":
            return "tasks"
        if entry.get("type") == "calendar":
            return "events"
        return "reminders"

    @staticmethod
    def _after_quiet_hours(moment: datetime, quiet: dict[str, Any]) -> datetime | None:
        if not quiet.get("enabled"):
            return moment
        from zoneinfo import ZoneInfo
        local = moment.astimezone(ZoneInfo("Europe/Madrid"))
        try:
            start_h, start_m = map(int, quiet["start"].split(":"))
            end_h, end_m = map(int, quiet["end"].split(":"))
        except (ValueError, KeyError):
            return moment
        minute = local.hour * 60 + local.minute
        start, end = start_h * 60 + start_m, end_h * 60 + end_m
        inside = start <= minute < end if start < end else minute >= start or minute < end
        if not inside:
            return moment
        if not quiet.get("deliverAfter"):
            return None
        day = local.date() + (timedelta(days=1) if start >= end and minute >= start else timedelta())
        return datetime.combine(day, datetime.min.time(), local.tzinfo).replace(hour=end_h, minute=end_m).astimezone(timezone.utc)

    def schedule(self, uid: str, entry_id: str, due_at: str) -> dict[str, Any]:
        if not isinstance(entry_id, str) or not entry_id or len(entry_id) > 200:
            raise ValueError("Recordatorio no válido")
        try:
            due = datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Fecha del aviso no válida") from error
        if due.tzinfo is None:
            from zoneinfo import ZoneInfo
            due = due.replace(tzinfo=ZoneInfo("Europe/Madrid"))
        due = due.astimezone(timezone.utc)
        if due <= datetime.now(timezone.utc):
            raise ValueError("El aviso debe estar en el futuro")
        client = self._tasks()
        reminder_ref = self._reminder_ref(uid, entry_id)
        previous = reminder_ref.get()
        previous_data = previous.to_dict() or {} if previous.exists else {}
        old_names = [item.get("name") for item in previous_data.get("tasks", []) if item.get("name")]
        if previous_data.get("taskName"):
            old_names.append(previous_data["taskName"])
        for old_name in old_names:
            try:
                client.delete_task(name=old_name)
            except Exception as error:
                if not self._not_found(error):
                    raise
        entry_snapshot = self._db().collection("users").document(uid).collection("entries").document(entry_id).get()
        entry = entry_snapshot.to_dict() or {} if entry_snapshot.exists else {}
        settings = self._settings(uid)
        entry_type = self._entry_type(entry)
        if not settings["types"].get(entry_type, False):
            reminder_ref.delete()
            return {"scheduled": False, "reason": "type_disabled", "type": entry_type}
        due_key = due.isoformat()
        generation = hashlib.sha256(f"{entry_id}:{due_key}:{settings}".encode()).hexdigest()[:24]
        moments = []
        if settings["beforeMinutes"]:
            moments.append(("before", due - timedelta(minutes=settings["beforeMinutes"])))
        if settings["atTime"]:
            moments.append(("at", due))
        if settings["afterMinutes"]:
            moments.append(("after", due + timedelta(minutes=settings["afterMinutes"])))
        from google.cloud import tasks_v2
        from google.protobuf import timestamp_pb2
        parent = client.queue_path(self.project, self.location, self.queue)
        created = []
        for kind, requested in moments:
            deliver_at = self._after_quiet_hours(requested, settings["quiet"])
            if not deliver_at or deliver_at <= datetime.now(timezone.utc):
                continue
            name = self._task_name(uid, entry_id, generation, kind)
            stamp = timestamp_pb2.Timestamp(); stamp.FromDatetime(deliver_at)
            task = tasks_v2.Task(name=name, schedule_time=stamp, http_request=tasks_v2.HttpRequest(
                http_method=tasks_v2.HttpMethod.POST, url=self.delivery_url, headers={"Content-Type": "application/json"},
                body=json.dumps({"uid": uid, "entryId": entry_id, "dueAt": due_key, "generation": generation, "kind": kind}).encode(),
                oidc_token=tasks_v2.OidcToken(service_account_email=self.delivery_account, audience=self.delivery_url.rsplit("/push/deliver", 1)[0])))
            client.create_task(parent=parent, task=task)
            created.append({"name": name, "kind": kind, "deliverAt": deliver_at.isoformat()})
        reminder_ref.set({"tasks": created, "dueAt": due_key, "generation": generation, "type": entry_type, "updatedAt": datetime.now(timezone.utc)})
        return {"scheduled": bool(created), "dueAt": due_key, "notices": len(created), "type": entry_type}

    def cancel(self, uid: str, entry_id: str) -> dict[str, Any]:
        reminder_ref = self._reminder_ref(uid, entry_id)
        snapshot = reminder_ref.get()
        data = snapshot.to_dict() or {} if snapshot.exists else {}
        names = [item.get("name") for item in data.get("tasks", []) if item.get("name")]
        if data.get("taskName"):
            names.append(data["taskName"])
        for task_name in names:
            try:
                self._tasks().delete_task(name=task_name)
            except Exception as error:
                if not self._not_found(error):
                    raise
        reminder_ref.delete()
        return {"cancelled": True}

    def send_test(self, uid: str, token: str | None = None) -> dict[str, Any]:
        return self._send(uid, "Angeli está lista", "Los avisos funcionan en este dispositivo.", "", "./", token)

    def deliver(self, uid: str, entry_id: str, due_at: str, generation: str, kind: str) -> dict[str, Any]:
        programmed = self._reminder_ref(uid, entry_id).get()
        programmed_data = programmed.to_dict() or {} if programmed.exists else {}
        if not programmed.exists or programmed_data.get("dueAt") != due_at or programmed_data.get("generation") != generation:
            return {"delivered": 0, "skipped": "stale"}
        snapshot = self._db().collection("users").document(uid).collection("entries").document(entry_id).get()
        if not snapshot.exists:
            return {"delivered": 0, "skipped": "missing"}
        entry = snapshot.to_dict() or {}
        schedule = entry.get("schedule") or {}
        is_active_event = entry.get("type") == "calendar" and entry.get("calendarStatus") == "synced"
        if entry.get("status") != "pending" or (schedule.get("status") != "scheduled" and not is_active_event):
            return {"delivered": 0, "skipped": "inactive"}
        remaining = [item for item in programmed_data.get("tasks", []) if item.get("kind") != kind]
        if remaining:
            self._reminder_ref(uid, entry_id).update({"tasks": remaining, "updatedAt": datetime.now(timezone.utc)})
        else:
            self._reminder_ref(uid, entry_id).delete()
        title = str(schedule.get("title") or entry.get("title") or entry.get("text") or "Recordatorio")[:100]
        body = str(schedule.get("description") or "Tienes un recordatorio pendiente en Angeli.")[:240]
        if kind == "before":
            body = f"Próximamente: {body}"
        elif kind == "after":
            body = f"Sigue pendiente: {body}"
        return self._send(uid, title, body, entry_id, f"./?reminder={entry_id}")

    def _send(self, uid: str, title: str, body: str, entry_id: str, url: str, only_token: str | None = None) -> dict[str, Any]:
        from firebase_admin import messaging

        documents = list(self._db().collection("users").document(uid).collection("pushDevices").stream())
        if only_token:
            documents = [document for document in documents if document.to_dict().get("token") == only_token]
        if not documents:
            return {"delivered": 0, "devices": 0}
        messages = [messaging.Message(data={"title": title, "body": body, "entryId": entry_id, "url": url}, token=doc.to_dict()["token"]) for doc in documents]
        response = messaging.send_each(messages, app=_firebase_app())
        for document, result in zip(documents, response.responses):
            if not result.success and type(result.exception).__name__ in {"UnregisteredError", "SenderIdMismatchError"}:
                document.reference.delete()
        return {"delivered": response.success_count, "failed": response.failure_count, "devices": len(documents)}


def verify_delivery_identity(environ: dict[str, Any], expected_email: str, audience: str) -> None:
    token = environ.get("HTTP_AUTHORIZATION", "").removeprefix("Bearer ").strip()
    if not token:
        raise PermissionError("Falta identificación de entrega")
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token

    claims = id_token.verify_oauth2_token(token, Request(), audience=audience)
    if claims.get("email") != expected_email or not claims.get("email_verified"):
        raise PermissionError("Identidad de entrega no autorizada")
