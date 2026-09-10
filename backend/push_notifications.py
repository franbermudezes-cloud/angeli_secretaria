"""Programación y entrega de avisos propios de la PWA de Angeli."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
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

    def _task_name(self, uid: str, entry_id: str, due_at: str) -> str:
        digest = hashlib.sha256(f"{uid}:{entry_id}:{due_at}".encode()).hexdigest()[:40]
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
        old_name = (previous.to_dict() or {}).get("taskName") if previous.exists else ""
        if old_name:
            try:
                client.delete_task(name=old_name)
            except Exception as error:
                if not self._not_found(error):
                    raise
        due_key = due.isoformat()
        name = self._task_name(uid, entry_id, due_key)
        from google.cloud import tasks_v2
        from google.protobuf import timestamp_pb2

        stamp = timestamp_pb2.Timestamp()
        stamp.FromDatetime(due)
        task = tasks_v2.Task(
            name=name,
            schedule_time=stamp,
            http_request=tasks_v2.HttpRequest(
                http_method=tasks_v2.HttpMethod.POST,
                url=self.delivery_url,
                headers={"Content-Type": "application/json"},
                body=json.dumps({"uid": uid, "entryId": entry_id, "dueAt": due_key}).encode(),
                oidc_token=tasks_v2.OidcToken(
                    service_account_email=self.delivery_account,
                    audience=self.delivery_url.rsplit("/push/deliver", 1)[0],
                ),
            ),
        )
        parent = client.queue_path(self.project, self.location, self.queue)
        client.create_task(parent=parent, task=task)
        reminder_ref.set({"taskName": name, "dueAt": due_key, "updatedAt": datetime.now(timezone.utc)})
        return {"scheduled": True, "dueAt": due.isoformat()}

    def cancel(self, uid: str, entry_id: str) -> dict[str, Any]:
        reminder_ref = self._reminder_ref(uid, entry_id)
        snapshot = reminder_ref.get()
        task_name = (snapshot.to_dict() or {}).get("taskName") if snapshot.exists else ""
        if task_name:
            try:
                self._tasks().delete_task(name=task_name)
            except Exception as error:
                if not self._not_found(error):
                    raise
        reminder_ref.delete()
        return {"cancelled": True}

    def send_test(self, uid: str) -> dict[str, Any]:
        return self._send(uid, "Angeli está lista", "Los avisos funcionan en este dispositivo.", "", "./")

    def deliver(self, uid: str, entry_id: str, due_at: str) -> dict[str, Any]:
        programmed = self._reminder_ref(uid, entry_id).get()
        if not programmed.exists or (programmed.to_dict() or {}).get("dueAt") != due_at:
            return {"delivered": 0, "skipped": "stale"}
        snapshot = self._db().collection("users").document(uid).collection("entries").document(entry_id).get()
        if not snapshot.exists:
            return {"delivered": 0, "skipped": "missing"}
        entry = snapshot.to_dict() or {}
        schedule = entry.get("schedule") or {}
        if schedule.get("status") != "scheduled":
            return {"delivered": 0, "skipped": "inactive"}
        self._reminder_ref(uid, entry_id).delete()
        title = str(schedule.get("title") or entry.get("title") or entry.get("text") or "Recordatorio")[:100]
        body = str(schedule.get("description") or "Tienes un recordatorio pendiente en Angeli.")[:240]
        return self._send(uid, title, body, entry_id, f"./?reminder={entry_id}")

    def _send(self, uid: str, title: str, body: str, entry_id: str, url: str) -> dict[str, Any]:
        from firebase_admin import messaging

        documents = list(self._db().collection("users").document(uid).collection("pushDevices").stream())
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
