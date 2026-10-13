from __future__ import annotations

import re
from datetime import date
from typing import Any

from .analytics import calculate_statistics, filter_transactions


def _won(value: int | float) -> str:
    return f"{int(value):,}원"


def _month_range(question: str, available_year: int = 2026) -> tuple[date | None, date | None, str]:
    iso_match = re.search(r"(20\d{2})[-./년 ]\s*(1[0-2]|0?[1-9])월?", question)
    plain_match = re.search(r"(?<!\d)(1[0-2]|[1-9])월", question)
    if iso_match:
        year, month = int(iso_match.group(1)), int(iso_match.group(2))
    elif plain_match:
        year, month = available_year, int(plain_match.group(1))
    else:
        return None, None, "전체 기간"
    next_month = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    end = date.fromordinal(next_month.toordinal() - 1)
    return date(year, month, 1), end, f"{year}년 {month}월"


def try_local_answer(question: str, transactions: list[dict[str, Any]]) -> str | None:
    normalized = re.sub(r"\s+", "", question.lower())
    complex_words = ("왜", "평가", "조언", "개선", "추천", "계획", "습관", "분석해", "줄이려", "어떻게")
    if any(word in normalized for word in complex_words):
        return None

    start, end, label = _month_range(question)
    rows = filter_transactions(transactions, start, end)
    stats = calculate_statistics(rows)
    metrics = stats["metrics"]
    if not rows:
        return f"{label}에 조회할 수 있는 거래가 없습니다."

    if "엥겔" in normalized:
        return f"{label} 엥겔지수는 {metrics['engel_index']:.1f}%입니다. 식비와 카페·간식 지출은 {_won(metrics['food_total'])}입니다."
    if "평균소비성향" in normalized or "소비성향" in normalized:
        return f"{label} 평균소비성향은 {metrics['average_propensity_to_consume']:.1f}%입니다. 수입 {_won(stats['income_total'])} 중 {_won(stats['expense_total'])}을 소비했습니다."
    if "고정비" in normalized:
        return f"{label} 고정비는 {_won(metrics['fixed_total'])}으로 전체 소비의 {metrics['fixed_cost_ratio']:.1f}%입니다."
    if "주거" in normalized or "월세" in normalized:
        return f"{label} 주거비는 {_won(metrics['housing_total'])}으로 전체 소비의 {metrics['housing_ratio']:.1f}%입니다."
    if "선택소비" in normalized or "선택지출" in normalized:
        return f"{label} 선택소비는 {_won(metrics['discretionary_total'])}으로 전체 소비의 {metrics['discretionary_ratio']:.1f}%입니다."
    if any(word in normalized for word in ("가장많", "최대지출", "1위", "큰카테고리")):
        top = stats["top_category"]
        return f"{label} 가장 지출이 큰 카테고리는 {top['category']}이며 총 {_won(top['value'])}입니다."
    if "평균" in normalized and any(word in normalized for word in ("지출", "소비")):
        return f"{label} 지출 거래 1건당 평균 금액은 {_won(metrics['expense_average'])}입니다."
    if any(word in normalized for word in ("건수", "몇건", "데이터개수")):
        return f"{label} 거래는 총 {stats['count']}건이며 수입 {stats['income_count']}건, 지출 {stats['expense_count']}건입니다."
    if any(word in normalized for word in ("잔액", "남은돈", "수입과지출", "수입지출")):
        return f"{label} 수입은 {_won(stats['income_total'])}, 지출은 {_won(stats['expense_total'])}, 차액은 {_won(stats['balance'])}입니다."
    if any(word in normalized for word in ("총지출", "지출얼마", "얼마썼", "소비금액", "총소비")):
        return f"{label} 총지출은 {_won(stats['expense_total'])}입니다."
    if any(word in normalized for word in ("총수입", "수입얼마", "얼마벌")):
        return f"{label} 총수입은 {_won(stats['income_total'])}입니다."
    if "기간" in normalized:
        return f"저장된 데이터 기간은 {stats['period']['label']}이며 총 {stats['count']}건입니다."
    return None

