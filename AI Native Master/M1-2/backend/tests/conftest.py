from __future__ import annotations

import csv
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
PROJECT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.dependencies import get_repository  # noqa: E402
from app.main import app  # noqa: E402
from app.models import TransactionInput  # noqa: E402
from app.repositories.memory import MemoryRepository  # noqa: E402


@pytest.fixture
def repository() -> MemoryRepository:
    repo = MemoryRepository()
    csv_path = PROJECT / "data" / "jobseeker_spending_2026-06_to_2026-08.csv"
    with csv_path.open(encoding="utf-8-sig", newline="") as file:
        for index, raw in enumerate(csv.DictReader(file), start=1):
            payload = TransactionInput(
                date=raw["date"], value=int(raw["value"]), memo=raw["memo"], type=raw["type"], category=raw["category"],
                is_fixed=raw["is_fixed"] == "true", is_essential=raw["is_essential"] == "true",
            )
            repo.create_transaction(payload.model_dump(), f"seed-{index:03}")
    return repo


@pytest.fixture
def client(repository: MemoryRepository):
    app.dependency_overrides[get_repository] = lambda: repository
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

