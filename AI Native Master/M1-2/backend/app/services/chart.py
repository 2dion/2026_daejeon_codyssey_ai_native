from __future__ import annotations

import json
import os
from functools import lru_cache
from io import BytesIO
from typing import Any

os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter


def render_monthly_cashflow(statistics: dict[str, Any], theme: str = "light") -> bytes:
    monthly_json = json.dumps(statistics["monthly"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _render_monthly_cashflow(monthly_json, theme)


@lru_cache(maxsize=32)
def _render_monthly_cashflow(monthly_json: str, theme: str) -> bytes:
    monthly = json.loads(monthly_json)
    months = [row["month"] for row in monthly]
    incomes = [row["income"] for row in monthly]
    expenses = [row["expense"] for row in monthly]

    dark = theme == "dark"
    background = "#111827" if dark else "#ffffff"
    text = "#e5e7eb" if dark else "#172033"
    grid = "#374151" if dark else "#e2e8f0"
    figure, axis = plt.subplots(figsize=(10, 4.8), dpi=140)
    figure.patch.set_facecolor(background)
    axis.set_facecolor(background)

    positions = range(len(months))
    width = 0.34
    axis.bar([position - width / 2 for position in positions], incomes, width, label="Income", color="#2f9e7a")
    axis.bar([position + width / 2 for position in positions], expenses, width, label="Spending", color="#ff7a59")
    axis.plot(list(positions), expenses, color="#8b5cf6", marker="o", linewidth=2, label="Spending trend")
    axis.set_xticks(list(positions), months)
    axis.set_title("Monthly income and spending", color=text, fontsize=15, fontweight="bold", pad=16)
    axis.set_ylabel("KRW", color=text)
    axis.yaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value / 1_000_000:.1f}M"))
    axis.tick_params(colors=text)
    for spine in axis.spines.values():
        spine.set_color(grid)
    axis.grid(axis="y", color=grid, linestyle="--", alpha=0.7)
    axis.set_axisbelow(True)
    legend = axis.legend(frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(0.5, -0.15))
    for label in legend.get_texts():
        label.set_color(text)
    figure.tight_layout()

    buffer = BytesIO()
    figure.savefig(buffer, format="png", facecolor=background, bbox_inches="tight")
    plt.close(figure)
    return buffer.getvalue()
