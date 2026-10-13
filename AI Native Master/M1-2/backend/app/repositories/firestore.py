from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serializable(payload: dict[str, Any]) -> dict[str, Any]:
    result = dict(payload)
    if isinstance(result.get("date"), date):
        result["date"] = result["date"].isoformat()
    return result


class FirestoreRepository:
    def __init__(self, service_account_value: str | None = None) -> None:
        if not firebase_admin._apps:
            if service_account_value:
                stripped = service_account_value.strip()
                if stripped.startswith("{"):
                    credential = credentials.Certificate(json.loads(stripped))
                else:
                    credential = credentials.Certificate(str(Path(stripped).expanduser()))
                firebase_admin.initialize_app(credential)
            elif os.getenv("FIRESTORE_EMULATOR_HOST"):
                firebase_admin.initialize_app(options={"projectId": os.getenv("GCLOUD_PROJECT", "naedon-local")})
            else:
                firebase_admin.initialize_app()
        self.db = firestore.client()

    def list_transactions(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for snapshot in self.db.collection("data").stream():
            row = snapshot.to_dict() or {}
            row["id"] = snapshot.id
            rows.append(row)
        return sorted(rows, key=lambda row: (row.get("date", ""), row["id"]))

    def create_transaction(self, payload: dict[str, Any], document_id: str | None = None) -> dict[str, Any]:
        collection = self.db.collection("data")
        reference = collection.document(document_id) if document_id else collection.document()
        current = reference.get()
        now = utc_now()
        row = _serializable(payload)
        row.update({"created_at": (current.to_dict() or {}).get("created_at", now) if current.exists else now, "updated_at": now})
        reference.set(row)
        return {"id": reference.id, **row}

    def update_transaction(self, document_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        reference = self.db.collection("data").document(document_id)
        current = reference.get()
        if not current.exists:
            return None
        row = _serializable(payload)
        row.update({"created_at": (current.to_dict() or {}).get("created_at", utc_now()), "updated_at": utc_now()})
        reference.set(row)
        return {"id": document_id, **row}

    def delete_transaction(self, document_id: str) -> bool:
        reference = self.db.collection("data").document(document_id)
        if not reference.get().exists:
            return False
        reference.delete()
        return True

    def create_conversation(self, title: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
        reference = self.db.collection("conversations").document()
        now = utc_now()
        row = {"title": title, "messages": messages, "created_at": now, "updated_at": now}
        reference.set(row)
        return {"id": reference.id, **row}

    def list_conversations(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for snapshot in self.db.collection("conversations").stream():
            rows.append({"id": snapshot.id, **(snapshot.to_dict() or {})})
        return sorted(rows, key=lambda row: row.get("updated_at", ""), reverse=True)

    def get_conversation(self, document_id: str) -> dict[str, Any] | None:
        snapshot = self.db.collection("conversations").document(document_id).get()
        return {"id": snapshot.id, **(snapshot.to_dict() or {})} if snapshot.exists else None

    def append_conversation_messages(self, document_id: str, messages: list[dict[str, Any]]) -> dict[str, Any] | None:
        reference = self.db.collection("conversations").document(document_id)
        current = reference.get()
        if not current.exists:
            return None
        row = current.to_dict() or {}
        row["messages"] = [*(row.get("messages") or []), *messages]
        row["updated_at"] = utc_now()
        reference.set(row)
        return {"id": document_id, **row}

    def delete_conversation(self, document_id: str) -> bool:
        reference = self.db.collection("conversations").document(document_id)
        if not reference.get().exists:
            return False
        reference.delete()
        return True

