"""Business logic for iOS widget QR pairing, device revocation, and read-only summary payloads."""

from __future__ import annotations

import asyncio
import hashlib
import re
import secrets
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.economic_calendar import get_economic_calendar
from src.adapters.macro import get_tcmb_calendar
from src.adapters.utils import ISTANBUL_TZ, InvalidInputError, normalize_symbol
from src.core.time import utcnow
from src.db.models import WidgetDevice
from src.db.repositories.widget import WidgetRepository
from src.schemas.widget import (
    WidgetCalendarEventOut,
    WidgetIndexSummaryOut,
    WidgetStockQuoteOut,
    WidgetSummaryOut,
    WidgetWatchlistSummaryOut,
)
from src.services import market_service

logger = structlog.get_logger(__name__)

PAIRING_MINUTES = 10
CODE_LENGTH = 8
# Unambiguous when read aloud or typed from a screen: no 0/O, 1/I/L look-alikes.
PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
DEFAULT_WIDGET_TICKERS: tuple[str, ...] = ("THYAO", "GARAN", "SISE", "ASELS", "EREGL")
MAX_WIDGET_TICKERS = 20
MAX_UPCOMING_EVENTS = 24
UPCOMING_WINDOW_DAYS = 45
DEFAULT_DELAY_SECONDS = 900

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_pairing_code() -> str:
    return "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(CODE_LENGTH))


def generate_device_token() -> str:
    return secrets.token_urlsafe(32)


def normalize_pairing_code(raw: str) -> str:
    return "".join(ch for ch in raw.upper() if ch.isalnum())


def sanitize_device_name(raw: str | None) -> str:
    cleaned = " ".join((raw or "").strip().split())
    return (cleaned[:60] or "iPhone")


def sanitize_watchlist_tickers(raw: Sequence[str] | None) -> list[str]:
    cleaned: list[str] = []
    for item in raw or ():
        try:
            symbol = normalize_symbol(str(item))
        except InvalidInputError:
            continue
        if symbol not in cleaned:
            cleaned.append(symbol)
        if len(cleaned) >= MAX_WIDGET_TICKERS:
            break
    return cleaned or list(DEFAULT_WIDGET_TICKERS)


def sanitize_label(raw: str | None, max_len: int = 80) -> str:
    return " ".join((raw or "").strip().split())[:max_len]


def _slug(value: str) -> str:
    cleaned = _SLUG_RE.sub("-", value.lower()).strip("-")
    return cleaned[:48] or "event"


def _istanbul_morning(day: date, hour: int = 9, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=ISTANBUL_TZ)


def _parse_iso_datetime(value: str | None, fallback_day: date | None = None) -> datetime | None:
    if value:
        raw = value.strip()
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=ISTANBUL_TZ)
            return parsed
        except ValueError:
            pass
    if fallback_day is not None:
        return _istanbul_morning(fallback_day)
    return None


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def _tcmb_events(payload: dict[str, Any] | None, *, today: date, until_date: date) -> list[WidgetCalendarEventOut]:
    if not isinstance(payload, dict) or payload.get("error"):
        return []
    out: list[WidgetCalendarEventOut] = []
    for row in payload.get("events") or ():
        if not isinstance(row, dict):
            continue
        event_day = _parse_date(str(row.get("date") or ""))
        if event_day is None or event_day < today or event_day > until_date:
            continue
        kind_code = str(row.get("type") or row.get("kind") or "tcmb").strip().lower()
        title = str(row.get("label") or row.get("title") or "TCMB Toplantısı").strip()
        # PPK rate decisions are announced at 14:00 Istanbul time; reports at 10:30.
        hour, minute = (14, 0) if "ppk" in kind_code and "ozet" not in kind_code else (10, 30)
        scheduled_at = _istanbul_morning(event_day, hour=hour, minute=minute)
        stable_id = f"tcmb:{_slug(kind_code)}:{event_day.isoformat()}"
        out.append(
            WidgetCalendarEventOut(
                id=stable_id,
                kind="economic",
                title=title,
                subtitle="TCMB",
                country="TR",
                scheduled_at=scheduled_at,
                date=event_day.isoformat(),
                importance="high",
                deep_link=f"hisseanalizi://event/{stable_id}",
            )
        )
    return out


def _economic_calendar_events(
    payload: dict[str, Any] | None,
    *,
    now_istanbul: datetime,
    until_date: date,
) -> list[WidgetCalendarEventOut]:
    if not isinstance(payload, dict) or payload.get("error"):
        return []
    out: list[WidgetCalendarEventOut] = []
    for row in payload.get("calendar") or ():
        if not isinstance(row, dict):
            continue
        event_day = _parse_date(str(row.get("Date") or row.get("date") or ""))
        if event_day is None or event_day > until_date:
            continue
        scheduled_at = _parse_iso_datetime(str(row.get("datetime") or ""), fallback_day=event_day)
        if scheduled_at is None or scheduled_at < now_istanbul - timedelta(minutes=15):
            continue
        title = str(row.get("title_tr") or row.get("Event") or row.get("title") or "").strip()
        if not title:
            continue
        country = str(row.get("country_code") or row.get("country") or "TR").upper()[:4]
        raw_id = str(row.get("id") or _slug(title))
        stable_id = f"econ:{country.lower()}:{_slug(raw_id)}:{event_day.isoformat()}"
        subtitle_parts = [country]
        if row.get("Forecast") or row.get("forecast"):
            subtitle_parts.append(f"Beklenti: {row.get('Forecast') or row.get('forecast')}")
        out.append(
            WidgetCalendarEventOut(
                id=stable_id,
                kind="economic",
                title=title,
                subtitle=" · ".join(subtitle_parts),
                country=country,
                scheduled_at=scheduled_at,
                date=event_day.isoformat(),
                importance=str(row.get("importance") or "high"),
                deep_link=f"hisseanalizi://event/{stable_id}",
            )
        )
    return out


async def _safe_quotes(symbols: tuple[str, ...]) -> tuple[dict[str, dict[str, Any]], bool, int, str | None]:
    if not symbols:
        return {}, False, DEFAULT_DELAY_SECONDS, None
    try:
        result = await asyncio.wait_for(market_service.get_quotes(symbols), timeout=6.0)
        meta = result.meta
        return (
            result.quotes,
            bool(meta.stale) if meta is not None else False,
            meta.delay_seconds if (meta is not None and meta.delay_seconds is not None) else DEFAULT_DELAY_SECONDS,
            meta.as_of if meta is not None else None,
        )
    except Exception as exc:
        logger.warning("widget_quotes_unavailable", symbols=list(symbols), error=f"{type(exc).__name__}: {exc}")
        return {}, True, DEFAULT_DELAY_SECONDS, None


async def _safe_tcmb_calendar() -> dict[str, Any] | None:
    try:
        return await asyncio.wait_for(get_tcmb_calendar(), timeout=4.0)
    except Exception as exc:
        logger.warning("widget_tcmb_calendar_unavailable", error=f"{type(exc).__name__}: {exc}")
        return None


async def _safe_economic_calendar(today: date, until_date: date) -> dict[str, Any] | None:
    try:
        return await asyncio.wait_for(
            get_economic_calendar(
                "TR,US",
                start=today.isoformat(),
                end=until_date.isoformat(),
                importance="high",
            ),
            timeout=5.0,
        )
    except Exception as exc:
        logger.warning("widget_economic_calendar_unavailable", error=f"{type(exc).__name__}: {exc}")
        return None


async def build_widget_summary(db: AsyncSession, device: WidgetDevice) -> WidgetSummaryOut:
    """Assemble the read-only BIST 100 + watchlist + upcoming calendar summary for an iOS widget."""
    now_utc = utcnow()
    now_istanbul = now_utc.astimezone(ISTANBUL_TZ)
    today = now_istanbul.date()
    until_date = today + timedelta(days=UPCOMING_WINDOW_DAYS)

    tickers = sanitize_watchlist_tickers(device.tickers)
    repo = WidgetRepository(db)

    all_symbols = tuple(dict.fromkeys(("XU100", *tickers)))
    quotes_res, tcmb_payload, econ_payload = await asyncio.gather(
        _safe_quotes(all_symbols),
        _safe_tcmb_calendar(),
        _safe_economic_calendar(today, until_date),
    )
    quotes, stale, delay_seconds, meta_as_of = quotes_res

    company_names = await repo.company_names_for_tickers(tickers)
    expected_rows = await repo.upcoming_expected_disclosures(tickers, from_date=today, until_date=until_date)
    dividend_rows = await repo.upcoming_dividends(tickers, from_date=today, until_date=until_date)

    bist_raw = quotes.get("XU100") or {}
    bist100 = WidgetIndexSummaryOut(
        symbol="XU100",
        name="BIST 100",
        last=bist_raw.get("last"),
        change=bist_raw.get("change"),
        change_percent=bist_raw.get("change_percent"),
        updated_at=bist_raw.get("updated_at"),
        session_state=bist_raw.get("session_state"),
    )

    items: list[WidgetStockQuoteOut] = []
    timestamps: list[str] = []
    if bist100.updated_at:
        timestamps.append(bist100.updated_at)

    for ticker in tickers:
        q = quotes.get(ticker) or {}
        if q.get("updated_at"):
            timestamps.append(str(q["updated_at"]))
        items.append(
            WidgetStockQuoteOut(
                ticker=ticker,
                name=company_names.get(ticker) or q.get("name"),
                last=q.get("last"),
                change=q.get("change"),
                change_percent=q.get("change_percent"),
                updated_at=q.get("updated_at"),
            )
        )

    events_by_id: dict[str, WidgetCalendarEventOut] = {}

    for ticker, disclosure in expected_rows:
        target_day = disclosure.start_date or disclosure.end_date
        if target_day is None:
            continue
        period_slug = _slug(f"{disclosure.fiscal_year or target_day.year}-{disclosure.period_term or disclosure.subject}")
        stable_id = f"earnings:{ticker}:{period_slug}"
        period_parts = [p for p in (str(disclosure.fiscal_year) if disclosure.fiscal_year else None, disclosure.period_term) if p]
        subtitle = " · ".join(period_parts) if period_parts else "KAP Beklenen Bildirim"
        events_by_id[stable_id] = WidgetCalendarEventOut(
            id=stable_id,
            kind="earnings",
            title=f"{ticker} {disclosure.subject}",
            subtitle=subtitle,
            ticker=ticker,
            country="TR",
            scheduled_at=_istanbul_morning(target_day, hour=9, minute=0),
            date=target_day.isoformat(),
            end_date=disclosure.end_date.isoformat() if disclosure.end_date else None,
            importance="high",
            deep_link=f"hisseanalizi://stock/{ticker}?tab=financials",
        )

    for ticker, dividend in dividend_rows:
        target_day = dividend.ex_date if dividend.ex_date >= today else (dividend.payment_date or dividend.ex_date)
        stable_id = f"dividend:{ticker}:{dividend.ex_date.isoformat()}"
        if dividend.net_per_share is not None:
            subtitle = f"Net {float(dividend.net_per_share):.2f} TL / pay"
        elif dividend.gross_per_share is not None:
            subtitle = f"Brüt {float(dividend.gross_per_share):.2f} TL / pay"
        else:
            subtitle = "Nakit temettü"
        events_by_id[stable_id] = WidgetCalendarEventOut(
            id=stable_id,
            kind="dividend",
            title=f"{ticker} Temettü",
            subtitle=subtitle,
            ticker=ticker,
            country="TR",
            scheduled_at=_istanbul_morning(target_day, hour=9, minute=0),
            date=target_day.isoformat(),
            end_date=dividend.payment_date.isoformat() if dividend.payment_date else None,
            importance="high",
            deep_link=f"hisseanalizi://stock/{ticker}?tab=dividends",
        )

    for event in _tcmb_events(tcmb_payload, today=today, until_date=until_date):
        events_by_id[event.id] = event

    for event in _economic_calendar_events(econ_payload, now_istanbul=now_istanbul, until_date=until_date):
        events_by_id.setdefault(event.id, event)

    upcoming_events = sorted(
        events_by_id.values(),
        key=lambda e: (e.scheduled_at.astimezone(UTC), e.kind, e.id),
    )[:MAX_UPCOMING_EVENTS]

    session_state = (
        bist100.session_state
        or next((q.get("session_state") for q in quotes.values() if q.get("session_state")), None)
        or "closed"
    )
    data_as_of = max(timestamps) if timestamps else meta_as_of

    return WidgetSummaryOut(
        generated_at=now_utc,
        data_as_of=data_as_of,
        timezone="Europe/Istanbul",
        session_state=session_state,
        delay_seconds=delay_seconds,
        stale=stale or (bist100.last is None and all(i.last is None for i in items)),
        bist100=bist100,
        watchlist=WidgetWatchlistSummaryOut(
            id=device.watchlist_id or "favorites",
            name=device.watchlist_name or "Favoriler",
            items=items,
        ),
        upcoming_events=upcoming_events,
        dashboard_id=device.dashboard_id,
    )
