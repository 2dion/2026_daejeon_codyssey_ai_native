from __future__ import annotations

import csv
from datetime import date
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ..dependencies import get_repository
from ..models import Category, TransactionInput, TransactionResponse, TransactionType
from ..repositories import Repository
from ..services.analytics import calculate_statistics, compact_summary, filter_transactions
from ..services.chart import render_monthly_cashflow

router = APIRouter(prefix="/api/data", tags=["data"])


def _filtered(
    repository: Repository,
    start_date: date | None,
    end_date: date | None,
    category: str | None,
    transaction_type: str | None,
) -> list[dict]:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="시작일은 종료일보다 늦을 수 없습니다.")
    return filter_transactions(repository.list_transactions(), start_date, end_date, category, transaction_type)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_data(payload: TransactionInput, repository: Repository = Depends(get_repository)):
    return repository.create_transaction(payload.model_dump())


@router.get("")
def list_data(
    start_date: date | None = None,
    end_date: date | None = None,
    category: Category | None = None,
    type: TransactionType | None = Query(default=None),
    repository: Repository = Depends(get_repository),
):
    items = sorted(
        _filtered(repository, start_date, end_date, category, type),
        key=lambda row: (row["date"], row.get("id", "")),
        reverse=True,
    )
    return {"items": items, "total": len(items)}


@router.get("/summary")
def get_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    category: Category | None = None,
    repository: Repository = Depends(get_repository),
):
    statistics = calculate_statistics(_filtered(repository, start_date, end_date, category, None))
    return compact_summary(statistics)


@router.get("/statistics")
def get_statistics(
    start_date: date | None = None,
    end_date: date | None = None,
    category: Category | None = None,
    repository: Repository = Depends(get_repository),
):
    return calculate_statistics(_filtered(repository, start_date, end_date, category, None))


@router.get("/export.csv")
def export_csv(
    start_date: date | None = None,
    end_date: date | None = None,
    category: Category | None = None,
    repository: Repository = Depends(get_repository),
):
    rows = _filtered(repository, start_date, end_date, category, None)
    output = StringIO()
    output.write("\ufeff")
    writer = csv.DictWriter(output, fieldnames=["date", "value", "memo", "type", "category", "is_fixed", "is_essential"])
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row[key] for key in writer.fieldnames})
    headers = {"Content-Disposition": 'attachment; filename="naedon-transactions.csv"'}
    return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/charts/monthly-cashflow.png")
def monthly_cashflow_chart(
    theme: str = Query(default="light", pattern="^(light|dark)$"),
    start_date: date | None = None,
    end_date: date | None = None,
    category: Category | None = None,
    repository: Repository = Depends(get_repository),
):
    rows = _filtered(repository, start_date, end_date, category, None)
    if not rows:
        raise HTTPException(status_code=404, detail="그래프로 표시할 데이터가 없습니다.")
    image = render_monthly_cashflow(calculate_statistics(rows), theme)
    return Response(content=image, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})


@router.put("/{document_id}", response_model=TransactionResponse)
def update_data(document_id: str, payload: TransactionInput, repository: Repository = Depends(get_repository)):
    updated = repository.update_transaction(document_id, payload.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="거래를 찾을 수 없습니다.")
    return updated


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_data(document_id: str, repository: Repository = Depends(get_repository)):
    if not repository.delete_transaction(document_id):
        raise HTTPException(status_code=404, detail="거래를 찾을 수 없습니다.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
