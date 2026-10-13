from __future__ import annotations

import argparse
import csv
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.dependencies import get_repository  # noqa: E402
from app.models import TransactionInput  # noqa: E402


def deterministic_id(row: dict[str, str]) -> str:
    canonical = "|".join(row[key] for key in ["date", "value", "memo", "type", "category", "is_fixed", "is_essential"])
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def main() -> None:
    parser = argparse.ArgumentParser(description="가상 소비 CSV를 Firestore에 중복 없이 적재합니다.")
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()
    repository = get_repository()
    count = 0
    with args.csv_path.open(encoding="utf-8-sig", newline="") as file:
        for raw in csv.DictReader(file):
            payload = TransactionInput(
                date=raw["date"],
                value=int(raw["value"]),
                memo=raw["memo"],
                type=raw["type"],
                category=raw["category"],
                is_fixed=raw["is_fixed"].lower() == "true",
                is_essential=raw["is_essential"].lower() == "true",
            )
            repository.create_transaction(payload.model_dump(), deterministic_id(raw))
            count += 1
    print(f"적재 완료: {count}건 (같은 CSV를 다시 실행해도 문서 ID가 중복되지 않습니다.)")


if __name__ == "__main__":
    main()

