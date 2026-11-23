"""Alert rule evaluation: turns quotes and new KAP disclosures into push deliveries.

Deliveries are written with ``INSERT ... ON CONFLICT (device_id, dedup_key) DO
NOTHING``; the dedup key names the triggering fact, so re-running an evaluation
(worker restart, retried outbox entry) never creates a second notification:

* price crossing — ``price:<rule>:<n>`` (n = the rule's n-th crossing)
* daily change   — ``change:<rule>:<session date>`` (at most once per session)
* KAP disclosure — ``kap:<rule>:<normalized event id>``

Price rules fire on a *crossing*: a new rule first records which side of the
threshold the price is on (``armed``) and fires only when it moves across. After a
crossing the rule re-arms once the price has moved back by ``hysteresis_pct``
(``repeat='rearm'``) or stays done (``repeat='once'``). Prices are the stored
~15 minute delayed quotes; rules are evaluated only during the session and only on
quotes of today's session fetched within ``ALERTS_QUOTE_MAX_AGE_SECONDS``.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.enums import SEVERITY_RANK, Severity
from src.db.models import AlertDelivery, AlertRule, Company, Device, Quote

logger = structlog.get_logger(__name__)

PRICE_KINDS = ("price_above", "price_below")
QUOTE_KINDS = (*PRICE_KINDS, "change_pct")
_MAX_TITLE = 200
_MAX_BODY = 500

# --- Localized texts (the device's locale; Turkish fallback) -------------------------

_TEXTS: dict[str, dict[str, str]] = {
    "tr": {
        "price_above": "{ticker} {threshold} TL üstüne çıktı",
        "price_below": "{ticker} {threshold} TL altına indi",
        "change_up": "{ticker} günde %{change} yükseldi",
        "change_down": "{ticker} günde %{change} düştü",
        "price_body": "Son fiyat {price} TL · günlük %{change} · 15 dk gecikmeli ({time})",
        "kap_title": "{ticker} · yeni KAP bildirimi",
        "test_title": "Hisse Analizi bildirimi",
        "test_body": "Bildirimler bu cihazda çalışıyor.",
        "important": "Önemli",
    },
    "en": {
        "price_above": "{ticker} rose above {threshold} TRY",
        "price_below": "{ticker} fell below {threshold} TRY",
        "change_up": "{ticker} is up {change}% today",
        "change_down": "{ticker} is down {change}% today",
        "price_body": "Last {price} TRY · day {change}% · 15 min delayed ({time})",
        "kap_title": "{ticker} · new KAP disclosure",
        "test_title": "Hisse Analizi notification",
        "test_body": "Notifications work on this device.",
        "important": "Important",
    },
    "fr": {
        "price_above": "{ticker} au-dessus de {threshold} TRY",
        "price_below": "{ticker} sous {threshold} TRY",
        "change_up": "{ticker} en hausse de {change} % aujourd'hui",
        "change_down": "{ticker} en baisse de {change} % aujourd'hui",
        "price_body": "Dernier {price} TRY · jour {change} % · différé de 15 min ({time})",
        "kap_title": "{ticker} · nouvelle déclaration KAP",
        "test_title": "Notification Hisse Analizi",
        "test_body": "Les notifications fonctionnent sur cet appareil.",
        "important": "Important",
    },
}


def text(locale: str, key: str, **values: Any) -> str:
    table = _TEXTS.get(locale) or _TEXTS["tr"]
    return table[key].format(**values)


def format_number(value: Decimal | float | None, locale: str, digits: int = 2) -> str:
    """Locale decimal separator; missing values render as an em dash, never 0."""
    if value is None:
        return "—"
    formatted = f"{float(value):,.{digits}f}"
    if locale == "en":
        return formatted
    # tr/fr: 1.234,56 / 1 234,56
    grouped = formatted.replace(",", " " if locale == "fr" else "\u0007").replace(".", ",")
    return grouped.replace("\u0007", ".")


def _clip(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


# --- Pure decision logic ---------------------------------------------------------------

@dataclass(frozen=True)
class PriceDecision:
    fire: bool
    armed: bool | None


def evaluate_price_rule(
    kind: str,
    threshold: Decimal,
    price: Decimal,
    *,
    armed: bool | None,
    repeat: str,
    trigger_count: int,
    hysteresis_pct: Decimal,
) -> PriceDecision:
    """Crossing detection with hysteresis (see the module docstring)."""
    above = kind == "price_above"
    condition = price >= threshold if above else price <= threshold
    if armed is None:
        # First look: remember the side, never fire just because the rule was created.
        return PriceDecision(fire=False, armed=not condition)
    if armed:
        return PriceDecision(fire=condition, armed=not condition)
    band = threshold * hysteresis_pct / Decimal(100)
    back = price <= threshold - band if above else price >= threshold + band
    may_rearm = repeat == "rearm" or trigger_count == 0
    return PriceDecision(fire=False, armed=bool(back and may_rearm))


def change_triggered(direction: str | None, threshold: Decimal, change_pct: Decimal) -> bool:
    if direction == "up":
        return change_pct >= threshold
    if direction == "down":
        return change_pct <= -threshold
    return abs(change_pct) >= threshold


def kap_rule_matches(min_severity: str | None, severity: Severity) -> bool:
    if not min_severity:
        return True
    wanted = Severity.__members__.get(min_severity, Severity.INFO)
    return SEVERITY_RANK.get(severity, 0) >= SEVERITY_RANK.get(wanted, 0)


# --- Delivery writes -------------------------------------------------------------------

async def enqueue_delivery(
    session: AsyncSession,
    *,
    device_id: uuid.UUID,
    rule_id: uuid.UUID | None,
    dedup_key: str,
    kind: str,
    ticker: str | None,
    title: str,
    body: str,
    url: str,
    ttl_seconds: int,
) -> uuid.UUID | None:
    """Insert a pending delivery; None when this fact was already enqueued (idempotent)."""
    stmt = (
        insert(AlertDelivery)
        .values(
            id=uuid.uuid4(),
            device_id=device_id,
            rule_id=rule_id,
            dedup_key=dedup_key[:200],
            kind=kind,
            ticker=ticker,
            title=_clip(title, _MAX_TITLE),
            body=_clip(body, _MAX_BODY),
            url=url[:500],
            ttl_seconds=ttl_seconds,
            status="pending",
            attempted_subscription_ids=[],
        )
        .on_conflict_do_nothing(constraint="uq_alert_deliveries_device_dedup")
        .returning(AlertDelivery.id)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


def _time_label(moment: datetime | None) -> str:
    if moment is None:
        return "—"
    from src.adapters.price import ISTANBUL_TZ

    return moment.astimezone(ISTANBUL_TZ).strftime("%H:%M")


async def evaluate_quote_rules(session: AsyncSession, now: datetime) -> dict[str, int]:
    """Evaluate price and daily-change rules against today's stored quotes; commits."""
    stats = {"rules": 0, "fired": 0, "state_changes": 0, "conflicts": 0}
    if not settings.push_enabled:
        return stats
    from src.services import market_service as ms

    if not ms.in_session(now):
        return stats
    today = now.date()
    fresh_after = now - timedelta(seconds=settings.alerts_quote_max_age_seconds)
    rows = (
        await session.execute(
            select(AlertRule, Company.ticker, Device.locale, Quote.last, Quote.change_pct, Quote.quote_time, Quote.fetched_at)
            .join(Company, Company.id == AlertRule.company_id)
            .join(Device, Device.id == AlertRule.device_id)
            .join(Quote, Quote.symbol == Company.ticker)
            .where(
                AlertRule.enabled.is_(True),
                AlertRule.kind.in_(QUOTE_KINDS),
                Quote.session_date == today,
                Quote.fetched_at >= fresh_after,
                Quote.last.is_not(None),
            )
        )
    ).all()

    for rule, ticker, locale, last, change_pct, quote_time, fetched_at in rows:
        stats["rules"] += 1
        price = Decimal(last)
        values: dict[str, Any] = {"armed": rule.armed}
        fire = False
        dedup = ""
        title = ""
        if rule.kind in PRICE_KINDS and rule.threshold is not None:
            decision = evaluate_price_rule(
                rule.kind,
                Decimal(rule.threshold),
                price,
                armed=rule.armed,
                repeat=rule.repeat,
                trigger_count=rule.trigger_count,
                hysteresis_pct=Decimal(rule.hysteresis_pct),
            )
            values["armed"] = decision.armed
            if decision.fire:
                fire = True
                dedup = f"price:{rule.id}:{rule.trigger_count + 1}"
                title = text(locale, rule.kind, ticker=ticker, threshold=format_number(rule.threshold, locale))
        elif rule.kind == "change_pct" and rule.threshold is not None and change_pct is not None:
            change = Decimal(change_pct)
            already_today = rule.last_triggered_at is not None and rule.last_triggered_at.astimezone(now.tzinfo).date() == today
            if not already_today and change_triggered(rule.direction, Decimal(rule.threshold), change):
                fire = True
                dedup = f"change:{rule.id}:{today.isoformat()}"
                key = "change_up" if change >= 0 else "change_down"
                title = text(locale, key, ticker=ticker, change=format_number(abs(change), locale))

        if not fire and values["armed"] == rule.armed:
            continue
        if fire:
            values.update(trigger_count=AlertRule.trigger_count + 1, last_triggered_at=now)
        # Guard on version: a concurrent user edit wins and is evaluated next minute.
        updated = await session.execute(
            update(AlertRule)
            .where(AlertRule.id == rule.id, AlertRule.version == rule.version)
            .values(**values)
            .returning(AlertRule.id)
            .execution_options(synchronize_session=False)
        )
        if updated.scalar_one_or_none() is None:
            stats["conflicts"] += 1
            continue
        if not fire:
            stats["state_changes"] += 1
            continue
        body = text(
            locale,
            "price_body",
            price=format_number(price, locale),
            change=format_number(change_pct, locale),
            time=_time_label(quote_time or fetched_at),
        )
        created = await enqueue_delivery(
            session,
            device_id=rule.device_id,
            rule_id=rule.id,
            dedup_key=dedup,
            kind=rule.kind,
            ticker=ticker,
            title=title,
            body=body,
            url=f"/hisse/{ticker}",
            ttl_seconds=settings.push_ttl_price_seconds,
        )
        if created is not None:
            stats["fired"] += 1
    await session.commit()
    return stats


@dataclass(frozen=True)
class KapEvent:
    id: uuid.UUID
    company_id: uuid.UUID
    ticker: str
    title: str | None
    excerpt: str | None
    severity: Severity


async def enqueue_kap_alerts(session: AsyncSession, event: KapEvent) -> int:
    """Create deliveries for every enabled KAP rule matching this event (no commit)."""
    if not settings.push_enabled:
        return 0
    rows = (
        await session.execute(
            select(AlertRule.id, AlertRule.device_id, AlertRule.min_severity, Device.locale)
            .join(Device, Device.id == AlertRule.device_id)
            .where(AlertRule.company_id == event.company_id, AlertRule.kind == "kap", AlertRule.enabled.is_(True))
        )
    ).all()
    created = 0
    for rule_id, device_id, min_severity, locale in rows:
        if not kap_rule_matches(min_severity, event.severity):
            continue
        headline = (event.title or "").strip() or "—"
        if event.severity == Severity.HIGH:
            headline = f"{text(locale, 'important')}: {headline}"
        summary = (event.excerpt or "").strip()
        body = headline if not summary or summary.casefold() == headline.casefold() else f"{headline} — {summary}"
        delivery = await enqueue_delivery(
            session,
            device_id=device_id,
            rule_id=rule_id,
            dedup_key=f"kap:{rule_id}:{event.id}",
            kind="kap",
            ticker=event.ticker,
            title=text(locale, "kap_title", ticker=event.ticker),
            body=body,
            url=f"/events?ticker={event.ticker}&event={event.id}",
            ttl_seconds=settings.push_ttl_kap_seconds,
        )
        if delivery is not None:
            created += 1
    return created
