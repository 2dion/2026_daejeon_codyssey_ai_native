from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Iterable

FOOD_CATEGORIES = {"식비", "카페·간식"}


def _date_text(value: Any) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)


def filter_transactions(
    transactions: Iterable[dict[str, Any]],
    start_date: date | None = None,
    end_date: date | None = None,
    category: str | None = None,
    transaction_type: str | None = None,
) -> list[dict[str, Any]]:
    start = start_date.isoformat() if start_date else None
    end = end_date.isoformat() if end_date else None
    result = []
    for transaction in transactions:
        transaction_date = _date_text(transaction["date"])
        if start and transaction_date < start:
            continue
        if end and transaction_date > end:
            continue
        if category and transaction["category"] != category:
            continue
        if transaction_type and transaction["type"] != transaction_type:
            continue
        result.append({**transaction, "date": transaction_date})
    return sorted(result, key=lambda row: (row["date"], row.get("id", "")))


def _percent(numerator: int | float, denominator: int | float) -> float:
    return round(numerator / denominator * 100, 1) if denominator else 0.0


def calculate_statistics(transactions: Iterable[dict[str, Any]]) -> dict[str, Any]:
    rows = list(transactions)
    expenses = [row for row in rows if row["type"] == "expense"]
    incomes = [row for row in rows if row["type"] == "income"]
    income_total = sum(int(row["value"]) for row in incomes)
    expense_total = sum(int(row["value"]) for row in expenses)
    expense_values = [int(row["value"]) for row in expenses]

    food_total = sum(int(row["value"]) for row in expenses if row["category"] in FOOD_CATEGORIES)
    housing_total = sum(int(row["value"]) for row in expenses if row["category"] == "주거")
    fixed_total = sum(int(row["value"]) for row in expenses if bool(row.get("is_fixed")))
    discretionary_total = sum(int(row["value"]) for row in expenses if not bool(row.get("is_essential")))

    category_totals: dict[str, int] = defaultdict(int)
    monthly: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"income": 0, "expense": 0, "count": 0, "food": 0, "housing": 0, "fixed": 0, "discretionary": 0}
    )
    for row in rows:
        month = _date_text(row["date"])[:7]
        value = int(row["value"])
        monthly[month][row["type"]] += value
        monthly[month]["count"] += 1
        if row["type"] == "expense":
            category_totals[row["category"]] += value
            if row["category"] in FOOD_CATEGORIES:
                monthly[month]["food"] += value
            if row["category"] == "주거":
                monthly[month]["housing"] += value
            if bool(row.get("is_fixed")):
                monthly[month]["fixed"] += value
            if not bool(row.get("is_essential")):
                monthly[month]["discretionary"] += value

    monthly_rows = []
    previous_expense: int | None = None
    for month in sorted(monthly):
        item = {"month": month, **monthly[month]}
        item["engel_index"] = _percent(item["food"], item["expense"])
        item["average_propensity_to_consume"] = _percent(item["expense"], item["income"])
        item["expense_change_rate"] = (
            round((item["expense"] - previous_expense) / previous_expense * 100, 1)
            if previous_expense
            else None
        )
        previous_expense = item["expense"]
        monthly_rows.append(item)

    latest_change = monthly_rows[-1]["expense_change_rate"] if monthly_rows else None
    if latest_change is None:
        trend = "비교 데이터 부족"
    elif latest_change > 3:
        trend = f"상승 (+{latest_change:.1f}%)"
    elif latest_change < -3:
        trend = f"감소 ({latest_change:.1f}%)"
    else:
        trend = f"유지 ({latest_change:+.1f}%)"

    dates = [_date_text(row["date"]) for row in rows]
    sorted_categories = sorted(category_totals.items(), key=lambda item: (-item[1], item[0]))
    return {
        "period": {
            "start": min(dates) if dates else None,
            "end": max(dates) if dates else None,
            "label": f"{min(dates)} ~ {max(dates)}" if dates else "데이터 없음",
        },
        "count": len(rows),
        "income_count": len(incomes),
        "expense_count": len(expenses),
        "income_total": income_total,
        "expense_total": expense_total,
        "balance": income_total - expense_total,
        "metrics": {
            "expense_average": round(sum(expense_values) / len(expense_values)) if expense_values else 0,
            "expense_max": max(expense_values, default=0),
            "expense_min": min(expense_values, default=0),
            "food_total": food_total,
            "housing_total": housing_total,
            "fixed_total": fixed_total,
            "discretionary_total": discretionary_total,
            "engel_index": _percent(food_total, expense_total),
            "housing_ratio": _percent(housing_total, expense_total),
            "average_propensity_to_consume": _percent(expense_total, income_total),
            "fixed_cost_ratio": _percent(fixed_total, expense_total),
            "discretionary_ratio": _percent(discretionary_total, expense_total),
        },
        "trend": trend,
        "top_category": {"category": sorted_categories[0][0], "value": sorted_categories[0][1]} if sorted_categories else None,
        "category_totals": [{"category": category, "value": value} for category, value in sorted_categories],
        "monthly": monthly_rows,
    }


def compact_summary(statistics: dict[str, Any]) -> dict[str, Any]:
    metrics = statistics["metrics"]
    return {
        "period": statistics["period"]["label"],
        "count": statistics["count"],
        "income_total": statistics["income_total"],
        "expense_total": statistics["expense_total"],
        "balance": statistics["balance"],
        "engel_index": metrics["engel_index"],
        "housing_ratio": metrics["housing_ratio"],
        "average_propensity_to_consume": metrics["average_propensity_to_consume"],
        "fixed_cost_ratio": metrics["fixed_cost_ratio"],
        "discretionary_ratio": metrics["discretionary_ratio"],
        "trend": statistics["trend"],
        "top_categories": statistics["category_totals"][:5],
        "monthly": [
            {
                "month": row["month"],
                "income": row["income"],
                "expense": row["expense"],
                "expense_change_rate": row["expense_change_rate"],
            }
            for row in statistics["monthly"]
        ],
    }

