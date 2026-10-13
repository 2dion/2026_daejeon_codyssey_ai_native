from app.services.analytics import calculate_statistics
from app.services.chart import _render_monthly_cashflow, render_monthly_cashflow


def test_seed_statistics(repository):
    result = calculate_statistics(repository.list_transactions())
    assert result["count"] == 180
    assert result["income_total"] == 3_920_000
    assert result["expense_total"] == 3_588_500
    assert [row["count"] for row in result["monthly"]] == [60, 60, 60]
    assert [row["expense"] for row in result["monthly"]] == [1_190_100, 1_271_200, 1_127_200]
    assert result["trend"].startswith("감소")
    assert 0 < result["metrics"]["engel_index"] < 100


def test_statistics_are_safe_for_empty_data():
    result = calculate_statistics([])
    assert result["count"] == 0
    assert result["metrics"]["engel_index"] == 0
    assert result["monthly"] == []


def test_chart_reuses_cached_image(repository):
    statistics = calculate_statistics(repository.list_transactions())
    _render_monthly_cashflow.cache_clear()

    first = render_monthly_cashflow(statistics, "light")
    second = render_monthly_cashflow(statistics, "light")

    assert first == second
    assert _render_monthly_cashflow.cache_info().hits == 1
