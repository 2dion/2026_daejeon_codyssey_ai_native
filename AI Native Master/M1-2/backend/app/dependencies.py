from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

from .config import get_settings
from .models import TransactionInput
from .repositories import FirestoreRepository, MemoryRepository, Repository


@lru_cache
def get_repository() -> Repository:
    settings = get_settings()
    if settings.data_backend == "memory":
        repository = MemoryRepository()
        sample_path = Path(__file__).resolve().parents[2] / "data" / "jobseeker_spending_2026-06_to_2026-08.csv"
        if sample_path.exists():
            with sample_path.open(encoding="utf-8-sig", newline="") as file:
                for index, raw in enumerate(csv.DictReader(file), start=1):
                    payload = TransactionInput(
                        date=raw["date"],
                        value=int(raw["value"]),
                        memo=raw["memo"],
                        type=raw["type"],
                        category=raw["category"],
                        is_fixed=raw["is_fixed"] == "true",
                        is_essential=raw["is_essential"] == "true",
                    )
                    repository.create_transaction(payload.model_dump(), f"sample-{index:03}")
        return repository
    if settings.data_backend != "firestore":
        raise RuntimeError("DATA_BACKEND는 firestore 또는 memory여야 합니다.")
    return FirestoreRepository(settings.firebase_service_account_json)
