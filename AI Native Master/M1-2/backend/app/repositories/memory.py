from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryRepository:
    """Test/local repository. Production defaults to Firestore."""

    def __init__(self) -> None:
        self.transactions: dict[str, dict[str, Any]] = {}
        self.conversations: dict[str, dict[str, Any]] = {}
        self._lock = RLock()

    def list_transactions(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(deepcopy(list(self.transactions.values())), key=lambda row: (row["date"], row["id"]))

    def create_transaction(self, payload: dict[str, Any], document_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            document_id = document_id or uuid4().hex
            now = utc_now()
            existing = self.transactions.get(document_id)
            row = deepcopy(payload)
            row.update({"id": document_id, "created_at": existing["created_at"] if existing else now, "updated_at": now})
            self.transactions[document_id] = row
            return deepcopy(row)

    def update_transaction(self, document_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            current = self.transactions.get(document_id)
            if not current:
                return None
            updated = deepcopy(payload)
            updated.update({"id": document_id, "created_at": current["created_at"], "updated_at": utc_now()})
            self.transactions[document_id] = updated
            return deepcopy(updated)

    def delete_transaction(self, document_id: str) -> bool:
        with self._lock:
            return self.transactions.pop(document_id, None) is not None

    def create_conversation(self, title: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
        with self._lock:
            document_id = uuid4().hex
            now = utc_now()
            row = {"id": document_id, "title": title, "messages": deepcopy(messages), "created_at": now, "updated_at": now}
            self.conversations[document_id] = row
            return deepcopy(row)

    def list_conversations(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(deepcopy(list(self.conversations.values())), key=lambda row: row["updated_at"], reverse=True)

    def get_conversation(self, document_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self.conversations.get(document_id)
            return deepcopy(row) if row else None

    def append_conversation_messages(self, document_id: str, messages: list[dict[str, Any]]) -> dict[str, Any] | None:
        with self._lock:
            row = self.conversations.get(document_id)
            if not row:
                return None
            row["messages"].extend(deepcopy(messages))
            row["updated_at"] = utc_now()
            return deepcopy(row)

    def delete_conversation(self, document_id: str) -> bool:
        with self._lock:
            return self.conversations.pop(document_id, None) is not None

