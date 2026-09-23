"""Şirket referans verileri — depo öncelikli okuma ve şirket başına yenileme (``reference.company``).

Uç noktalar (``/fundamentals/{ticker}/dividends|holders|recommendations|price-targets|
earnings-dates``) ``docs/data-platform.md`` §4.1 desenini izler::

    depo taze (≤ max_age)            → served_from="store"
    değilse canlı çek + depoya yaz    → served_from="live"
    canlı çekim başarısız, depo dolu → served_from="stale", stale=true
    canlı çekim başarısız, depo boş  → mevcut hata sözleşmesi (HTTP 404/502/503)

Yanıt gövdeleri eski sözleşmeyle birebir aynıdır (alan adları, sıraları, ``source`` metinleri);
yalnızca ``meta`` bloğu eklenir (router ``with_meta`` uygular). Canlı ve depodan dönen gövde
aynı normalize kayıtlardan kurulur (``src.adapters.fundamentals_reference.*_payload``).

"Tazelik": bir kümenin satırlarının en yeni ``fetched_at`` değeri; küme boşsa (ör. hiç temettü
dağıtmamış şirket) son başarılı ``reference.company`` çalıştırmasının ``details.datasets``
kaydı "boş ama taze" işaretidir. Veritabanı erişilemezse uçlar canlı moda düşer.

Kaynak eşlemesi: temettü + sermaye artırımı + İş Yatırım önerisi tek İş Yatırım "sermaye"
çağrısından (``isyatirim``); ortaklık yapısı İş Yatırım şirket kartından (uç nokta) ve KAP
"genel" sayfasından (resmî, çapraz kontrol); hedef fiyat konsensüsü hedeffiyat.com.tr'den
(``hedeffiyat``); beklenen bildirimler KAP'tan (``kap``).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, TypeVar

import structlog
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.bist_reference import (
    KAP_EXPECTED_DISCLOSURES_PAGE,
    KapCompanyGeneral,
    fetch_expected_disclosures,
    fetch_kap_general,
    kap_summary_url,
    resolve_member_oid,
)
from src.adapters.fundamentals_common import _require_listed
from src.adapters.fundamentals_reference import (
    HEDEFFIYAT_URL,
    ISYATIRIM_CARD_URL,
    LABEL_EARNINGS,
    LABEL_ISYATIRIM,
    SOURCE_HEDEFFIYAT,
    SOURCE_ISYATIRIM,
    SOURCE_KAP,
    HolderRecord,
    PriceTargetRecord,
    RecommendationRecord,
    SermayeBundle,
    current_price,
    dividends_payload_rows,
    earnings_payload_rows,
    fetch_holders,
    fetch_price_targets,
    fetch_sermaye,
    holders_payload_rows,
    recommendations_payload,
    targets_payload,
    to_decimal,
)
from src.adapters.utils import ISTANBUL_TZ, MarketDataError, finite_float, tradingview_scan
from src.core.config import settings
from src.core.meta import DataMeta, ServedFrom
from src.core.time import utcnow
from src.db.models import AnalystTarget, Company, DataQualityCheck
from src.db.repositories.reference import REFERENCE_COMPANY_JOB, ReferenceRepository, quality_check
from src.db.session import async_session_factory
from src.services.ingestion import run_job

logger = structlog.get_logger(__name__)

T = TypeVar("T")

# Dataset names used in ``reference.company`` run details (freshness markers).
DATASET_SERMAYE = "sermaye"          # dividends + capital increases + İş Yatırım recommendation
DATASET_HOLDERS = "holders"          # İş Yatırım ownership structure
DATASET_TARGETS = "targets"          # hedeffiyat.com.tr consensus
DATASET_EXPECTED = "expected"        # KAP expected disclosures
DATASET_KAP_GENERAL = "kap_general"  # KAP company page: official free float, website, ≥5% holders
DATASET_METRICS = "metrics"          # İş Yatırım company card: free float, foreign ownership
# A refresh counts as complete (``reference_updated_at``) without the consensus: borsapy
# cannot tell "no coverage" from "unreachable" for hedeffiyat.com.tr.
REQUIRED_DATASETS = (DATASET_SERMAYE, DATASET_HOLDERS, DATASET_EXPECTED, DATASET_KAP_GENERAL, DATASET_METRICS)

NOTE_STALE = "Sağlayıcıya ulaşılamadı; son kayıtlı veri"
NOTE_EMPTY_PROVIDER = "Sağlayıcı veri döndürmedi; son kayıtlı veri"
NOTE_UNAVAILABLE = "Sağlayıcıya ulaşılamadı; veri yok"
_MSG_COMPANY_UNKNOWN = "Şirket bulunamadı"


def _max_age() -> timedelta:
    return timedelta(hours=settings.reference_max_age_hours)


def _holders_max_age() -> timedelta:
    return timedelta(hours=settings.reference_holders_max_age_hours)


def _istanbul_day(value: datetime) -> str:
    return value.astimezone(ISTANBUL_TZ).date().isoformat()


def _today() -> date:
    return utcnow().astimezone(ISTANBUL_TZ).date()


def _meta(
    source: str,
    fetched_at: datetime,
    served_from: ServedFrom,
    *,
    source_url: str | None = None,
    as_of: str | None = None,
    notes: list[str] | None = None,
) -> DataMeta:
    return DataMeta(
        source=source,
        fetched_at=fetched_at,
        source_url=source_url,
        as_of=as_of or _istanbul_day(fetched_at),
        served_from=served_from,
        stale=served_from == "stale",
        notes=list(notes or []),
    )


def _latest(*stamps: datetime | None) -> datetime | None:
    values = [s for s in stamps if s is not None]
    return max(values) if values else None


class _Store:
    """Session wrapper: DB failures degrade the endpoint to live mode instead of failing it."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = ReferenceRepository(session)
        self.available = True

    async def read(self, fn: Callable[[ReferenceRepository], Awaitable[T]]) -> T | None:
        if not self.available:
            return None
        try:
            return await fn(self.repo)
        except (SQLAlchemyError, OSError) as e:
            logger.warning("reference_store_read_failed", error=f"{type(e).__name__}: {e}")
            self.available = False
            await self._rollback()
            return None

    async def write(self, fn: Callable[[ReferenceRepository], Awaitable[Any]]) -> bool:
        if not self.available:
            return False
        try:
            await fn(self.repo)
            await self.session.commit()
            return True
        except (SQLAlchemyError, OSError) as e:
            logger.warning("reference_store_write_failed", error=f"{type(e).__name__}: {e}")
            await self._rollback()
            return False

    async def _rollback(self) -> None:
        try:
            await self.session.rollback()
        except Exception:  # connection already gone
            pass

    async def company(self, ticker: str) -> Company | None:
        return await self.read(lambda r: r.company(ticker))

    async def marker(self, ticker: str, dataset: str) -> datetime | None:
        """Finish time of the latest refresh run in which ``dataset`` succeeded."""
        run = await self.read(lambda r: r.last_company_refresh(ticker))
        if run is None or not isinstance(run.details_json, dict):
            return None
        info = (run.details_json.get("datasets") or {}).get(dataset)
        return run.finished_at if isinstance(info, dict) and info.get("ok") else None


async def _ensure_listed(company: Company | None, ticker: str) -> None:
    """Legacy 404 for tickers KAP does not list; active universe companies skip the (KAP) lookup.

    A delisted company is checked like an unknown one: its stored history is then
    served as stale, and without stored data the answer stays the legacy 404.
    """
    if company is None or not company.is_active:
        await _require_listed(ticker)


# ---------------------------------------------------------------------------
# Record <-> row conversion for analyst targets
# ---------------------------------------------------------------------------

def _recommendation_from_row(row: AnalystTarget) -> RecommendationRecord:
    return RecommendationRecord(
        recommendation=row.recommendation, target_price=row.target_mean, upside_pct=row.upside_pct, as_of=row.as_of
    )


def _targets_from_row(row: AnalystTarget) -> PriceTargetRecord:
    return PriceTargetRecord(low=row.target_low, high=row.target_high, mean=row.target_mean, analysts=row.analysts_count)


async def _save_sermaye(repo: ReferenceRepository, company_id: Any, bundle: SermayeBundle, fetched_at: datetime) -> None:
    await repo.replace_dividends(company_id, SOURCE_ISYATIRIM, bundle.dividends, fetched_at)
    await repo.replace_capital_increases(company_id, SOURCE_ISYATIRIM, bundle.capital_increases, fetched_at)
    rec = bundle.recommendation
    if rec is None:
        await repo.delete_target(company_id, SOURCE_ISYATIRIM)
        return
    await repo.upsert_target(
        company_id,
        SOURCE_ISYATIRIM,
        {"as_of": rec.as_of, "target_mean": rec.target_price, "recommendation": rec.recommendation,
         "upside_pct": rec.upside_pct, "analysts_count": 1},
        fetched_at,
    )


async def _save_targets(
    repo: ReferenceRepository, company_id: Any, record: PriceTargetRecord, fetched_at: datetime, price: float | None
) -> None:
    mean = float(record.mean) if record.mean is not None else None
    upside = (mean / price - 1) * 100 if mean is not None and price else None
    await repo.upsert_target(
        company_id,
        SOURCE_HEDEFFIYAT,
        {"as_of": fetched_at.astimezone(ISTANBUL_TZ).date(), "target_low": record.low, "target_high": record.high,
         "target_mean": record.mean, "target_median": None, "analysts_count": record.analysts,
         "upside_pct": to_decimal(upside, 4)},
        fetched_at,
    )


# ---------------------------------------------------------------------------
# Store-first reads (API)
# ---------------------------------------------------------------------------

async def get_dividends(
    session: AsyncSession, ticker: str, *, max_age: timedelta | None = None
) -> tuple[dict[str, Any], DataMeta]:
    """Nakit temettü geçmişi (İş Yatırım), depo öncelikli."""
    store = _Store(session)
    company = await store.company(ticker)
    url = ISYATIRIM_CARD_URL.format(ticker=ticker)
    stored: tuple[list[Any], datetime] | None = None
    if company is not None:
        got = await store.read(lambda r: r.dividends(company.id, SOURCE_ISYATIRIM))
        if got is not None:
            fetched = _latest(got[1], None if got[0] else await store.marker(ticker, DATASET_SERMAYE))
            if fetched is not None:
                stored = (got[0], fetched)

    def body(records: list[Any]) -> dict[str, Any]:
        return {"ticker": ticker, "source": LABEL_ISYATIRIM, "dividends": dividends_payload_rows(records),
                "available": True}

    if stored is not None and utcnow() - stored[1] <= (max_age or _max_age()):
        return body(stored[0]), _meta(SOURCE_ISYATIRIM, stored[1], "store", source_url=url)
    try:
        await _ensure_listed(company, ticker)
        bundle = await fetch_sermaye(ticker)
    except MarketDataError as e:
        if stored is not None:
            logger.info("reference_served_stale", dataset="dividends", ticker=ticker, error=e.message)
            return body(stored[0]), _meta(SOURCE_ISYATIRIM, stored[1], "stale", source_url=url, notes=[NOTE_STALE])
        raise
    fetched_at = utcnow()
    if company is not None:
        await store.write(lambda r: _save_sermaye(r, company.id, bundle, fetched_at))
    return body(bundle.dividends), _meta(SOURCE_ISYATIRIM, fetched_at, "live", source_url=url)


async def get_recommendations(
    session: AsyncSession, ticker: str, *, max_age: timedelta | None = None
) -> tuple[dict[str, Any], DataMeta]:
    """İş Yatırım'ın kendi önerisi ve hedef fiyatı, depo öncelikli."""
    store = _Store(session)
    company = await store.company(ticker)
    url = ISYATIRIM_CARD_URL.format(ticker=ticker)
    stored: tuple[RecommendationRecord | None, datetime] | None = None
    if company is not None:
        row = await store.read(lambda r: r.target(company.id, SOURCE_ISYATIRIM))
        if row is not None:
            stored = (_recommendation_from_row(row), row.fetched_at)
        else:
            marker = await store.marker(ticker, DATASET_SERMAYE)
            if marker is not None:
                stored = (None, marker)

    def respond(record: RecommendationRecord | None, fetched: datetime, served: ServedFrom,
                notes: list[str] | None = None) -> tuple[dict[str, Any], DataMeta]:
        as_of = record.as_of.isoformat() if record is not None and record.as_of else None
        body = {"ticker": ticker, **recommendations_payload(record)}
        return body, _meta(SOURCE_ISYATIRIM, fetched, served, source_url=url, as_of=as_of, notes=notes)

    if stored is not None and utcnow() - stored[1] <= (max_age or _max_age()):
        return respond(stored[0], stored[1], "store")
    try:
        await _ensure_listed(company, ticker)
        bundle = await fetch_sermaye(ticker)
    except MarketDataError as e:
        if stored is not None:
            logger.info("reference_served_stale", dataset="recommendations", ticker=ticker, error=e.message)
            return respond(stored[0], stored[1], "stale", [NOTE_STALE])
        raise
    fetched_at = utcnow()
    if company is not None:
        await store.write(lambda r: _save_sermaye(r, company.id, bundle, fetched_at))
    return respond(bundle.recommendation, fetched_at, "live")


async def get_holders(
    session: AsyncSession, ticker: str, *, max_age: timedelta | None = None
) -> tuple[dict[str, Any], DataMeta]:
    """Ortaklık yapısı (İş Yatırım şirket kartı), depo öncelikli."""
    store = _Store(session)
    company = await store.company(ticker)
    url = ISYATIRIM_CARD_URL.format(ticker=ticker)
    stored: tuple[list[HolderRecord], datetime] | None = None
    if company is not None:
        got = await store.read(lambda r: r.shareholders(company.id, SOURCE_ISYATIRIM))
        if got is not None:
            fetched = _latest(got[1], None if got[0] else await store.marker(ticker, DATASET_HOLDERS))
            if fetched is not None:
                stored = (got[0], fetched)

    def body(records: list[HolderRecord]) -> dict[str, Any]:
        rows = holders_payload_rows(records)
        return {"ticker": ticker, "source": LABEL_ISYATIRIM, "holders": rows, "available": bool(rows)}

    if stored is not None and utcnow() - stored[1] <= (max_age or _holders_max_age()):
        return body(stored[0]), _meta(SOURCE_ISYATIRIM, stored[1], "store", source_url=url)
    try:
        await _ensure_listed(company, ticker)
        records = await fetch_holders(ticker)
    except MarketDataError as e:
        if stored is not None:
            logger.info("reference_served_stale", dataset="holders", ticker=ticker, error=e.message)
            return body(stored[0]), _meta(SOURCE_ISYATIRIM, stored[1], "stale", source_url=url, notes=[NOTE_STALE])
        raise
    fetched_at = utcnow()
    if company is not None and records:
        await store.write(lambda r: r.replace_shareholders(company.id, SOURCE_ISYATIRIM, records, fetched_at))
    elif not records and stored is not None and stored[0]:
        # An empty ownership table from İş Yatırım is a page glitch, not a divestment.
        return body(stored[0]), _meta(SOURCE_ISYATIRIM, stored[1], "stale", source_url=url,
                                      notes=[NOTE_EMPTY_PROVIDER])
    return body(records), _meta(SOURCE_ISYATIRIM, fetched_at, "live", source_url=url)


async def _price_or_none(ticker: str) -> float | None:
    try:
        return await current_price(ticker)
    except Exception as e:
        logger.warning("price_target_current_price_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
        return None


async def get_price_targets(
    session: AsyncSession, ticker: str, *, max_age: timedelta | None = None
) -> tuple[dict[str, Any], DataMeta]:
    """Analist hedef fiyat konsensüsü (hedeffiyat.com.tr) + güncel fiyat (TradingView, 15 dk gecikmeli)."""
    store = _Store(session)
    company = await store.company(ticker)
    stored: tuple[PriceTargetRecord | None, datetime] | None = None
    if company is not None:
        row = await store.read(lambda r: r.target(company.id, SOURCE_HEDEFFIYAT))
        if row is not None:
            stored = (_targets_from_row(row), row.fetched_at)
        else:
            marker = await store.marker(ticker, DATASET_TARGETS)
            if marker is not None:
                stored = (None, marker)

    async def respond(record: PriceTargetRecord | None, fetched: datetime, served: ServedFrom,
                      price: float | None, notes: list[str] | None = None) -> tuple[dict[str, Any], DataMeta]:
        body = {"ticker": ticker, **targets_payload(record, price)}
        return body, _meta(SOURCE_HEDEFFIYAT, fetched, served, source_url=HEDEFFIYAT_URL, notes=notes)

    if stored is not None and utcnow() - stored[1] <= (max_age or _max_age()):
        return await respond(stored[0], stored[1], "store", await _price_or_none(ticker))
    try:
        await _ensure_listed(company, ticker)
        record = await fetch_price_targets(ticker)
    except MarketDataError as e:
        if stored is not None:
            logger.info("reference_served_stale", dataset="price_targets", ticker=ticker, error=e.message)
            return await respond(stored[0], stored[1], "stale", await _price_or_none(ticker), [NOTE_STALE])
        raise
    price = await _price_or_none(ticker)
    fetched_at = utcnow()
    if record is None:
        if stored is not None and stored[0] is not None:
            return await respond(stored[0], stored[1], "stale", price, [NOTE_EMPTY_PROVIDER])
        return await respond(None, fetched_at, "live", price)
    if company is not None:
        await store.write(lambda r: _save_targets(r, company.id, record, fetched_at, price))
    return await respond(record, fetched_at, "live", price)


async def get_earnings_dates(
    session: AsyncSession, ticker: str, *, max_age: timedelta | None = None
) -> tuple[dict[str, Any], DataMeta]:
    """KAP beklenen finansal rapor tarihleri. Boş/erişilemez kaynak hata değil, ``available: false``."""
    store = _Store(session)
    company = await store.company(ticker)
    oid = company.kap_member_oid if company is not None else None
    url = kap_summary_url(oid) if oid else KAP_EXPECTED_DISCLOSURES_PAGE
    stored: tuple[list[Any], datetime] | None = None
    if company is not None:
        got = await store.read(lambda r: r.expected_disclosures(company.id))
        if got is not None:
            fetched = _latest(got[1], None if got[0] else await store.marker(ticker, DATASET_EXPECTED))
            if fetched is not None:
                stored = (got[0], fetched)

    def body(records: list[Any]) -> dict[str, Any]:
        rows = earnings_payload_rows(records, _today())
        return {"ticker": ticker, "source": LABEL_EARNINGS, "earnings_dates": rows, "available": bool(rows)}

    if stored is not None and utcnow() - stored[1] <= (max_age or _max_age()):
        return body(stored[0]), _meta(SOURCE_KAP, stored[1], "store", source_url=url)
    try:
        await _ensure_listed(company, ticker)  # unknown symbol → 404 (legacy contract)
    except MarketDataError:
        if stored is not None:
            return body(stored[0]), _meta(SOURCE_KAP, stored[1], "stale", source_url=url, notes=[NOTE_STALE])
        raise
    try:
        oid = oid or await resolve_member_oid(ticker)
        records = await fetch_expected_disclosures(oid, _today()) if oid else []
    except MarketDataError as e:
        if stored is not None:
            logger.info("reference_served_stale", dataset="earnings_dates", ticker=ticker, error=e.message)
            return body(stored[0]), _meta(SOURCE_KAP, stored[1], "stale", source_url=url, notes=[NOTE_STALE])
        logger.warning("fundamentals_earnings_unavailable", ticker=ticker, error=e.message)
        return body([]), _meta(SOURCE_KAP, utcnow(), "live", source_url=url, notes=[NOTE_UNAVAILABLE])
    fetched_at = utcnow()
    if company is not None and oid:
        today = _today()
        await store.write(lambda r: r.replace_expected_disclosures(company.id, records, fetched_at, today))
    return body(records), _meta(SOURCE_KAP, fetched_at, "live", source_url=url)


# ---------------------------------------------------------------------------
# Per-company refresh (worker job ``reference.company``)
# ---------------------------------------------------------------------------

_LEGAL_NOISE = re.compile(r"\b(A\s?Ş|T\s?A\s?Ş|A\s?O|T\s?A\s?O|S\s?A|AG|INC|LTD|PLC|NV|BV)\b")


def normalize_holder_name(name: str) -> str:
    """Comparable form of a shareholder name (ASCII, upper case, no punctuation/legal form)."""
    text = name.replace("ı", "i").replace("İ", "I")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").upper()
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    text = _LEGAL_NOISE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


_OTHER_HOLDERS = {"DIGER", "DIGERLERI", "HALKA ACIK", "OTHER", "OTHERS"}


def compare_holders(official: list[tuple[str, float | None]], provider: list[tuple[str, float | None]]) -> dict[str, Any]:
    """Match KAP ≥5% holders to İş Yatırım holders by normalised name; report the largest gap."""
    remaining = {normalize_holder_name(n): pct for n, pct in provider if n}
    matched: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for name, pct in official:
        key = normalize_holder_name(name)
        if not key or key in _OTHER_HOLDERS:
            continue
        hit = next((k for k in remaining if k == key or k.startswith(key) or key.startswith(k)), None)
        if hit is None:
            tokens = set(key.split())
            hit = next((k for k in remaining if tokens and len(tokens & set(k.split())) / len(tokens) >= 0.6), None)
        if hit is None:
            unmatched.append(name)
            continue
        other = remaining.pop(hit)
        gap = abs(pct - other) if pct is not None and other is not None else None
        matched.append({"holder": name, "kap": pct, "isyatirim": other, "gap": round(gap, 4) if gap is not None else None})
    gaps = [m["gap"] for m in matched if m["gap"] is not None]
    return {"matched": matched, "unmatched": unmatched, "max_gap": max(gaps) if gaps else None}


def _band(deviation: float | None, pass_up_to: float, warn_up_to: float) -> str:
    if deviation is None:
        return "warn"
    if deviation <= pass_up_to:
        return "pass"
    return "warn" if deviation <= warn_up_to else "fail"


@dataclass
class CompanyRefresh:
    ticker: str
    datasets: dict[str, dict[str, Any]] = field(default_factory=dict)
    company_values: dict[str, Any] = field(default_factory=dict)
    checks: list[DataQualityCheck] = field(default_factory=list)

    def ok(self, dataset: str, **info: Any) -> None:
        self.datasets[dataset] = {"ok": True, **info}

    def failed(self, dataset: str, error: str) -> None:
        self.datasets[dataset] = {"ok": False, "error": error[:300]}

    @property
    def complete(self) -> bool:
        return all(self.datasets.get(name, {}).get("ok") for name in REQUIRED_DATASETS)

    def summary(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "complete": self.complete,
            "datasets": self.datasets,
            "checks": {c.check_name: c.status for c in self.checks},
        }


def _error_text(exc: BaseException) -> str:
    return exc.message if isinstance(exc, MarketDataError) else f"{type(exc).__name__}: {exc}"


async def _tradingview_free_float(ticker: str) -> float | None:
    try:
        rows = await tradingview_scan([ticker], ("float_shares_percent_current",))
    except MarketDataError:
        return None
    value = finite_float((rows.get(ticker) or {}).get("float_shares_percent_current"))
    return value if value is not None and 0 <= value <= 100 else None


def _free_float_checks(
    ticker: str, general: KapCompanyGeneral | None, isy: float | None, tv: float | None
) -> list[DataQualityCheck]:
    kap_ff = general.free_float.get(ticker) if general is not None else None
    kap_value = kap_ff.ratio_pct if kap_ff is not None else None
    if kap_value is None:
        return []
    as_of = kap_ff.as_of.isoformat() if kap_ff is not None and kap_ff.as_of else None
    checks = []
    if isy is not None:
        gap = abs(isy - kap_value)
        checks.append(quality_check(
            "reference.free_float", _band(gap, 0.2, 1.0), subject=ticker, expected=kap_value, actual=isy,
            deviation=gap, details={"reference": "kap (MKK fiili dolaşım)", "reference_as_of": as_of,
                                    "compared": "isyatirim", "tradingview": tv},
        ))
    if tv is not None:
        gap = abs(tv - kap_value)
        checks.append(quality_check(
            "reference.free_float_tradingview", _band(gap, 0.5, 3.0), subject=ticker, expected=kap_value, actual=tv,
            deviation=gap, details={"reference": "kap (MKK fiili dolaşım)", "reference_as_of": as_of,
                                    "compared": "tradingview"},
        ))
    return checks


def _same_text(a: str | None, b: str | None) -> bool:
    return bool(a and b) and normalize_holder_name(a or "") == normalize_holder_name(b or "")


def _kap_page_checks(ticker: str, company: Company, general: KapCompanyGeneral) -> list[DataQualityCheck]:
    checks = []
    if company.sector and general.sub_sector:
        checks.append(quality_check(
            "reference.sector_match", "pass" if _same_text(company.sector, general.sub_sector) else "fail",
            subject=ticker, details={"stored": company.sector, "stored_source": "kap /tr/Sektorler",
                                     "reference": general.sector, "reference_source": "kap şirket sayfası"},
        ))
    if company.market_segment and general.markets:
        checks.append(quality_check(
            "reference.market_segment_match",
            "pass" if company.market_segment in general.markets else "fail",
            subject=ticker, details={"stored": company.market_segment, "stored_source": "kap /tr/Pazarlar",
                                     "reference": list(general.markets), "reference_source": "kap şirket sayfası"},
        ))
    return checks


async def _refresh_datasets(session: AsyncSession, company: Company, result: CompanyRefresh) -> None:
    """Fetch every dataset of one company sequentially, committing each (partial progress persists)."""
    ticker = company.ticker
    store = _Store(session)
    repo = store.repo
    today = _today()
    company_id = company.id

    try:
        bundle = await fetch_sermaye(ticker)
        fetched_at = utcnow()
        await _save_sermaye(repo, company_id, bundle, fetched_at)
        await session.commit()
        result.ok(DATASET_SERMAYE, dividends=len(bundle.dividends), capital_increases=len(bundle.capital_increases),
                  recommendation=bundle.recommendation is not None)
    except MarketDataError as e:
        result.failed(DATASET_SERMAYE, _error_text(e))

    isy_holders: list[HolderRecord] = []
    try:
        isy_holders = await fetch_holders(ticker)
        if isy_holders:
            await repo.replace_shareholders(company_id, SOURCE_ISYATIRIM, isy_holders, utcnow())
            await session.commit()
            result.ok(DATASET_HOLDERS, rows=len(isy_holders))
        else:
            result.failed(DATASET_HOLDERS, "İş Yatırım ortaklık tablosu boş")
    except MarketDataError as e:
        result.failed(DATASET_HOLDERS, _error_text(e))

    try:
        record = await fetch_price_targets(ticker)
        if record is None:
            result.failed(DATASET_TARGETS, "hedeffiyat.com.tr veri döndürmedi")
        else:
            await _save_targets(repo, company_id, record, utcnow(), await _price_or_none(ticker))
            await session.commit()
            result.ok(DATASET_TARGETS, analysts=record.analysts)
    except MarketDataError as e:
        result.failed(DATASET_TARGETS, _error_text(e))

    oid = company.kap_member_oid or await resolve_member_oid(ticker)
    general: KapCompanyGeneral | None = None
    if oid is None:
        result.failed(DATASET_KAP_GENERAL, "KAP üye kimliği bilinmiyor")
        result.failed(DATASET_EXPECTED, "KAP üye kimliği bilinmiyor")
    else:
        try:
            general = await fetch_kap_general(oid)
            kap_holders = [HolderRecord(name=h.name[:300], share_pct=to_decimal(h.share_pct, 4))
                           for h in general.shareholders]
            if kap_holders:
                await repo.replace_shareholders(company_id, SOURCE_KAP, kap_holders, utcnow(),
                                                as_of=general.shareholders_as_of)
                await session.commit()
            kap_ff = general.free_float.get(ticker)
            if kap_ff is not None and kap_ff.ratio_pct is not None:
                result.company_values["free_float_pct"] = to_decimal(kap_ff.ratio_pct, 2)
            if general.website:
                result.company_values["website"] = general.website[:300]
            result.ok(DATASET_KAP_GENERAL, holders=len(kap_holders),
                      free_float=kap_ff.ratio_pct if kap_ff is not None else None)
            result.checks.extend(_kap_page_checks(ticker, company, general))
        except MarketDataError as e:
            result.failed(DATASET_KAP_GENERAL, _error_text(e))
        try:
            records = await fetch_expected_disclosures(oid, today)
            await repo.replace_expected_disclosures(company_id, records, utcnow(), today)
            await session.commit()
            result.ok(DATASET_EXPECTED, rows=len(records))
        except MarketDataError as e:
            result.failed(DATASET_EXPECTED, _error_text(e))

    isy_free_float: float | None = None
    try:
        from src.adapters.price import get_company_metrics

        metrics = await get_company_metrics(ticker)
        isy_free_float = finite_float(metrics.get("free_float"))
        foreign = finite_float(metrics.get("foreign_ratio"))
        if foreign is not None and 0 <= foreign <= 100:
            result.company_values["foreign_ratio_pct"] = to_decimal(foreign, 2)
        if "free_float_pct" not in result.company_values and isy_free_float is not None:
            result.company_values["free_float_pct"] = to_decimal(isy_free_float, 2)
        result.ok(DATASET_METRICS, free_float=isy_free_float, foreign_ratio=foreign)
    except MarketDataError as e:
        result.failed(DATASET_METRICS, _error_text(e))

    tv_free_float = await _tradingview_free_float(ticker)
    result.checks.extend(_free_float_checks(ticker, general, isy_free_float, tv_free_float))
    if general is not None and general.shareholders and isy_holders:
        comparison = compare_holders(
            [(h.name, h.share_pct) for h in general.shareholders],
            [(h.name, float(h.share_pct) if h.share_pct is not None else None) for h in isy_holders],
        )
        max_gap = comparison["max_gap"]
        status = "warn" if comparison["unmatched"] and max_gap is not None and max_gap <= 1.0 else _band(max_gap, 0.1, 1.0)
        result.checks.append(quality_check(
            "reference.shareholders", status, subject=ticker, deviation=max_gap,
            details={"reference": "kap (≥%5 ortaklar)", "reference_as_of":
                     general.shareholders_as_of.isoformat() if general.shareholders_as_of else None,
                     "compared": "isyatirim", **comparison},
        ))


async def refresh_company(ticker: str) -> dict[str, Any]:
    """Refresh every reference dataset of one company (job ``reference.company``, scope = ticker)."""
    result = CompanyRefresh(ticker=ticker)
    async with run_job(REFERENCE_COMPANY_JOB, scope=ticker) as run:
        async with async_session_factory() as session:
            repo = ReferenceRepository(session)
            company = await repo.company(ticker)
            if company is None:
                raise MarketDataError(_MSG_COMPANY_UNKNOWN, status_code=404)
            await _refresh_datasets(session, company, result)
            values = dict(result.company_values)
            if result.complete:
                values["reference_updated_at"] = utcnow()
            try:
                if values:
                    await repo.update_company(company.id, values)
                if result.checks:
                    session.add_all(result.checks)
                await session.commit()
            except SQLAlchemyError as e:
                await session.rollback()
                logger.warning("reference_company_update_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
        run.items_total = len(result.datasets)
        run.items_ok = sum(1 for d in result.datasets.values() if d.get("ok"))
        run.items_failed = run.items_total - run.items_ok
        run.details = {"datasets": _json_safe(result.datasets), "complete": result.complete,
                       "checks": {c.check_name: c.status for c in result.checks}}
    return result.summary()


def _json_safe(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value
