"""The stock scorecard ("Şirket analiz karnesi") — same rules as the web card.

A port of ``dashboard/src/components/stock/FinancialHealthScorecard.tsx`` so the
assistant can explain a company's score with its inputs. Keep the thresholds in sync
(``tests/unit/test_assistant.py`` compares them with the TypeScript source).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

Direction = Literal["higher", "lower"]


@dataclass(frozen=True)
class Metric:
    id: str
    source: str  # ratio key, or "pe" / "pb"
    label: str
    direction: Direction
    thresholds: tuple[float, float, float, float]  # cut-offs for 5, 4, 3, 2 points
    non_positive_score: int | None = None


@dataclass(frozen=True)
class Category:
    id: str
    label: str
    metrics: tuple[Metric, ...]


CATEGORIES: tuple[Category, ...] = (
    Category("profitability", "Kârlılık", (
        Metric("roe", "roe", "ROE (%)", "higher", (30, 20, 10, 0)),
        Metric("netMargin", "net_margin", "Net kâr marjı (%)", "higher", (15, 8, 3, 0)),
    )),
    Category("growth", "Büyüme", (
        Metric("revGrowth", "revenue_growth_yoy", "Hasılat büyümesi (%)", "higher", (50, 30, 15, 0)),
        Metric("niGrowth", "net_income_growth_yoy", "Net kâr büyümesi (%)", "higher", (50, 30, 15, 0)),
    )),
    Category("health", "Finansal sağlık", (
        Metric("current", "current_ratio", "Cari oran", "higher", (2, 1.5, 1, 0.8)),
        Metric("de", "debt_to_equity", "Borç/Özkaynak", "lower", (0.5, 1, 2, 3)),
        Metric("nde", "net_debt_ebitda", "Net borç/FAVÖK", "lower", (0, 1, 2.5, 4)),
    )),
    Category("valuation", "Değerleme", (
        Metric("pe", "pe", "F/K", "lower", (8, 12, 18, 25), non_positive_score=1),
        Metric("pb", "pb", "PD/DD", "lower", (1, 2, 3, 5), non_positive_score=1),
    )),
)

TECH_SCORE: dict[str, int] = {"strongBuy": 5, "buy": 4, "neutral": 3, "sell": 2, "strongSell": 1}
TECH_LABEL: dict[str, str] = {
    "strongBuy": "Güçlü al", "buy": "Al", "neutral": "Nötr", "sell": "Sat", "strongSell": "Güçlü sat",
}
_SIGNAL_ALIASES: dict[str, str] = {
    "STRONG_BUY": "strongBuy", "BUY": "buy", "NEUTRAL": "neutral", "SELL": "sell", "STRONG_SELL": "strongSell",
}
LOSS_MAKING_PE = -1.0


def score_metric(value: float, metric: Metric) -> int:
    if metric.non_positive_score is not None and value <= 0:
        return metric.non_positive_score
    s5, s4, s3, s2 = metric.thresholds
    if metric.direction == "higher":
        return 5 if value >= s5 else 4 if value >= s4 else 3 if value >= s3 else 2 if value >= s2 else 1
    return 5 if value <= s5 else 4 if value <= s4 else 3 if value <= s3 else 2 if value <= s2 else 1


def _average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def normalize_signal(raw: Any) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    return _SIGNAL_ALIASES.get(raw.strip().upper().replace(" ", "_").replace("-", "_"))


def compute_scorecard(
    ratios: Mapping[str, Any],
    *,
    pe: float | None = None,
    pb: float | None = None,
    signal: str | None = None,
) -> dict[str, Any]:
    """Score like the web card. ``pe``/``pb`` are the quote's multiples (preferred, as on the
    page); ``ratios`` are ``/live-ratios`` values; ``signal`` the daily technical summary level."""

    def input_of(source: str) -> float | None:
        if source == "pe":
            value = pe if pe is not None else _number(ratios.get("pe_ratio"))
            if value is not None:
                return value
            margin = _number(ratios.get("net_margin"))
            return LOSS_MAKING_PE if margin is not None and margin < 0 else None
        if source == "pb":
            return pb if pb is not None else _number(ratios.get("pb_ratio"))
        return _number(ratios.get(source))

    categories: list[dict[str, Any]] = []
    category_scores: list[float] = []
    for category in CATEGORIES:
        metrics: list[dict[str, Any]] = []
        points: list[float] = []
        for metric in category.metrics:
            value = input_of(metric.source)
            score = None if value is None else score_metric(value, metric)
            if score is not None:
                points.append(score)
            metrics.append({
                "metric": metric.label,
                "value": "zarar" if metric.id == "pe" and value is not None and value <= 0 else value,
                "points": score,
                "rule": f"{'yüksek' if metric.direction == 'higher' else 'düşük'} iyi; 5/4/3/2 puan eşikleri {list(metric.thresholds)}",
            })
        avg = _average(points)
        if avg is not None:
            category_scores.append(avg)
        categories.append({"category": category.label, "score": avg, "metrics": metrics})

    level = normalize_signal(signal) if signal else None
    tech = TECH_SCORE.get(level) if level else None
    if tech is not None:
        category_scores.append(tech)
    categories.append({
        "category": "Teknik trend",
        "score": tech,
        "metrics": [{"metric": "Günlük teknik özet", "value": TECH_LABEL.get(level) if level else None, "points": tech}],
    })
    return {"overall": _average(category_scores), "out_of": 5, "categories": categories}
