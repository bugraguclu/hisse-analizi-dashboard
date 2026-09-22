import math
import re
from collections import Counter
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import PriceRecord, RawEventData
from src.core.enums import EventCategory, EventType, PriceInterval, Severity
from src.core.time import utcnow
from src.db.models import Company, Source
from src.db.repository import (
    FinancialRatioRepository,
    FinancialStatementRepository,
    NormalizedEventRepository,
    OutboxRepository,
    PriceDataRepository,
    RawEventRepository,
)
from src.parsers.helpers import clean_whitespace, compute_dedup_key, strip_html
from src.services.analysis_service import AnalysisService

logger = structlog.get_logger(__name__)

SOURCE_TO_EVENT_TYPE = {
    "kap": EventType.KAP_DISCLOSURE,
    "anadoluefes_news": EventType.OFFICIAL_NEWS,
    "anadoluefes_ir": EventType.OFFICIAL_IR_UPDATE,
    "official_news": EventType.OFFICIAL_NEWS,
    "official_ir": EventType.OFFICIAL_IR_UPDATE,
}

# Default severity when no keyword rule matches.
SOURCE_TO_SEVERITY = {
    "kap": Severity.WATCH,
    "anadoluefes_news": Severity.INFO,
    "anadoluefes_ir": Severity.WATCH,
    "official_news": Severity.INFO,
    "official_ir": Severity.WATCH,
}

# --- Keyword classification -------------------------------------------------------
# KAP titles are disclosure *form names* ("Özel Durum Açıklaması (Genel)",
# "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim", ...) and the summary is usually
# the same text. Matching runs on a folded form of the text: Turkish-aware lower
# case with diacritics removed ("KARI"/"Karı"/"kari" all become "kari"), so the
# patterns below are written in plain ASCII.

_FOLD_TABLE = str.maketrans({"ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u"})


def fold_turkish(text: str) -> str:
    """Case- and diacritic-insensitive form of Turkish text for keyword matching."""
    lowered = text.replace("İ", "i").replace("I", "ı").lower().replace("̇", "")
    return re.sub(r"\s+", " ", lowered.translate(_FOLD_TABLE)).strip()


def _patterns(*regexes: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(r) for r in regexes)


# Material events -> HIGH (checked first).
HIGH_SEVERITY_PATTERNS = _patterns(
    r"sermaye artirim", r"sermaye azaltim", r"bedelsiz", r"bedelli", r"tahsisli", r"ruchan hakki",
    r"birlesme", r"bolunme", r"devralma", r"satin alma", r"finansal duran varlik (edinim|satis)",
    r"geri al(im|in)",  # pay geri alımı / geri alınan paylar
    r"kar payi", r"temettu", r"dividend",
    r"iflas", r"konkordato", r"tasfiye",
    r"ihale", r"yeni is iliskisi", r"siparis", r"(?<!esas )sozlesme",
    r"\bdava", r"sorusturma", r"suc duyurusu", r"para cezasi",
    r"tedbir", r"islem yasagi", r"islem sirasi", r"durdurul", r"kottan cikar", r"borsadan cikar",
    r"finansal rapor", r"finansal tablo", r"bilanco",
    r"ozsermaye hallerine", r"376\. madde",
)

# Boilerplate / periodic compliance filings -> INFO.
INFO_SEVERITY_PATTERNS = _patterns(
    r"bilgi formu", r"surdurulebilirlik", r"entegre rapor", r"\btsrs\b", r"sorumluluk beyani",
    r"faaliyet raporu", r"kurumsal yonetim", r"bagimsiz denetim", r"finansal takvim", r"politikasi\b",
    r"genel kurul", r"pay alim satim bildirimi", r"yonetim kurulu komiteleri", r"ticaret sicil",
    r"kamuyu aydinlatma platformu duyurusu", r"merkezi kayit kurulusu", r"islem goren tipe donusum",
    r"pay disinda sermaye piyasasi araci", r"borclanma arac", r"kira sertifika", r"ihrac belgesi",
    r"ihrac tavani", r"varant", r"piyasa yapiciligi", r"likidite saglayici", r"fiili dolasimdaki pay",
    r"portfoy sinirlamalari", r"yatirimci raporu", r"otoriteye mali tablo", r"unvan degisikligi",
    r"kayitli sermaye tavani",
    # Takasbank's settlement-default notices list many stock codes at once; routine.
    r"\btemerrut islemi\b",
)

CATEGORY_PATTERNS: tuple[tuple[EventCategory, tuple[re.Pattern[str], ...]], ...] = (
    (EventCategory.DIVIDEND, _patterns(r"temettu", r"kar payi", r"dividend")),
    (EventCategory.CAPITAL_INCREASE, _patterns(r"sermaye artirim", r"bedelli", r"bedelsiz", r"tahsisli", r"ruchan hakki")),
    (EventCategory.NEW_BUSINESS, _patterns(r"yeni is", r"ihale", r"siparis", r"(?<!esas )sozlesme")),
    (EventCategory.LEGAL, _patterns(r"\bdava", r"hukuki", r"ceza", r"sorusturma", r"suc duyurusu", r"tedbir", r"islem yasagi")),
    (EventCategory.MANAGEMENT, _patterns(r"yonetim kurulu", r"\batama", r"istifa", r"genel mudur")),
    (EventCategory.FINANCIAL_RESULTS, _patterns(r"finansal rapor", r"finansal tablo", r"bilanco", r"gelir tablosu", r"kar/zarar")),
)

_MAX_TITLE = 1000
_MAX_URL = 1000


def _classification_text(title: str | None, summary: str | None) -> str:
    return fold_turkish(f"{title or ''} {summary or ''}")


def classify_category(title: str | None, summary: str | None = None) -> EventCategory:
    """Keyword-based event category (first matching category wins)."""
    text = _classification_text(title, summary)
    for category, patterns in CATEGORY_PATTERNS:
        if any(p.search(text) for p in patterns):
            return category
    return EventCategory.OTHER


def classify_severity(title: str | None, summary: str | None, source_code: str) -> Severity:
    """Material events -> HIGH, boilerplate filings -> INFO, otherwise the source default."""
    text = _classification_text(title, summary)
    if any(p.search(text) for p in HIGH_SEVERITY_PATTERNS):
        return Severity.HIGH
    if any(p.search(text) for p in INFO_SEVERITY_PATTERNS):
        return Severity.INFO
    return SOURCE_TO_SEVERITY.get(source_code, Severity.INFO)


async def reclassify_events(session: AsyncSession, *, dry_run: bool = True, batch_size: int = 500) -> dict[str, Any]:
    """Re-apply the current classification rules to every stored event (idempotent).

    With ``dry_run`` nothing is written; the result reports what would change.
    """
    repo = NormalizedEventRepository(session)
    scanned = changed = 0
    severity_changes: Counter[str] = Counter()
    category_changes: Counter[str] = Counter()

    async for rows in repo.iter_classification_batches(batch_size):
        updates: list[dict[str, Any]] = []
        for event_id, title, excerpt, source_code, severity, category in rows:
            scanned += 1
            new_severity = classify_severity(title, excerpt, source_code)
            new_category = classify_category(title, excerpt)
            if new_severity == severity and new_category == category:
                continue
            changed += 1
            if new_severity != severity:
                severity_changes[f"{severity.value}->{new_severity.value}"] += 1
            if new_category != category:
                old_name = category.name if category is not None else "NONE"
                category_changes[f"{old_name}->{new_category.name}"] += 1
            updates.append({"id": event_id, "severity": new_severity, "category": new_category})
        if updates and not dry_run:
            await repo.bulk_update_classification(updates)

    if not dry_run:
        await session.commit()
    logger.info("events_reclassified", dry_run=dry_run, scanned=scanned, changed=changed)
    return {
        "dry_run": dry_run,
        "scanned": scanned,
        "changed": changed,
        "severity_changes": dict(severity_changes.most_common()),
        "category_changes": dict(category_changes.most_common()),
    }


def _truncate(value: str | None, limit: int) -> str | None:
    return value[:limit] if value else value


class EventService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.raw_repo = RawEventRepository(session)
        self.norm_repo = NormalizedEventRepository(session)
        self.outbox_repo = OutboxRepository(session)

    def _classify_event(self, title: str, summary: str | None) -> EventCategory:
        return classify_category(title, summary)

    def _classify_severity(self, title: str, summary: str | None, source_code: str) -> Severity:
        return classify_severity(title, summary, source_code)

    async def process_raw_events(
        self,
        events: list[RawEventData],
        source: Source,
        company: Company,
    ) -> dict[str, int]:
        """Store raw events, normalize them and enqueue one outbox entry per new event.

        Everything is committed in one transaction at the end.
        """
        stats = {"new_raw": 0, "new_normalized": 0, "outbox_created": 0, "duplicates": 0}
        source_code: str = source.code
        event_type = SOURCE_TO_EVENT_TYPE.get(source_code, EventType.KAP_DISCLOSURE)

        for event_data in events:
            if not event_data.content_hash:
                logger.warning("raw_event_without_hash_skipped", source=source_code, ticker=company.ticker)
                continue

            raw_event = await self.raw_repo.insert_if_not_exists(
                source_id=source.id,
                company_id=company.id,
                external_id=_truncate(event_data.external_id, 200),
                canonical_url=_truncate(event_data.canonical_url, _MAX_URL),
                source_event_type=_truncate(event_data.source_event_type, 100),
                title=_truncate(event_data.title, _MAX_TITLE),
                summary=event_data.summary,
                published_at=event_data.published_at,
                content_hash=event_data.content_hash,
                raw_payload_json=event_data.raw_payload_json,
                raw_payload_text=event_data.raw_payload_text,
                attachment_urls=event_data.attachment_urls,
                http_status=event_data.http_status,
                headers_json=event_data.headers_json,
            )

            if raw_event is None:
                stats["duplicates"] += 1
                continue
            stats["new_raw"] += 1

            severity = classify_severity(event_data.title, event_data.summary, source_code)
            category = classify_category(event_data.title, event_data.summary)
            # Missing publication time: fall back to ingestion time and flag it.
            published_at = event_data.published_at or utcnow()
            metadata: dict[str, Any] = {}
            if event_data.published_at is None:
                metadata["published_at_missing"] = True

            dedup_key = compute_dedup_key(
                source_code,
                event_data.canonical_url or "",
                published_at.isoformat(),
                event_data.title or "",
                scope=company.ticker,
            )

            norm_event = await self.norm_repo.insert_if_not_exists(
                raw_event_id=raw_event.id,
                company_id=company.id,
                event_type=event_type,
                title=_truncate(clean_whitespace(event_data.title), _MAX_TITLE) or None,
                excerpt=clean_whitespace(event_data.summary)[:500] if event_data.summary else None,
                body_text=strip_html(event_data.body_text) if event_data.body_text else None,
                published_at=published_at,
                event_url=_truncate(event_data.canonical_url, _MAX_URL),
                source_code=source_code,
                severity=severity,
                is_notifiable=True,
                category=category,
                dedup_key=dedup_key,
                metadata_json=metadata,
            )

            if norm_event is None:
                continue
            stats["new_normalized"] += 1

            payload = {
                "event_id": str(norm_event.id),
                "event_type": event_type.value,
                "title": norm_event.title,
                "source_code": source_code,
                "severity": severity.value,
                "published_at": published_at.isoformat(),
                "event_url": event_data.canonical_url,
            }
            await self.outbox_repo.create(norm_event.id, payload)
            stats["outbox_created"] += 1

        await self.session.commit()
        return stats


def _finite_or_none(value: Any) -> float | None:
    """NaN/Inf/unparsable -> None (Numeric/JSONB columns must never receive NaN)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _trading_date(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


_INTERVALS = {"1d": PriceInterval.ONE_DAY, "1h": PriceInterval.ONE_HOUR, "15m": PriceInterval.FIFTEEN_MIN}


class PriceService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.price_repo = PriceDataRepository(session)

    async def process_prices(
        self,
        records: list[PriceRecord],
        company: Company,
    ) -> dict[str, int]:
        """Upsert OHLCV rows. The current (still open) session's bar is refreshed on
        every poll instead of keeping the first intraday snapshot forever."""
        stats = {"new_prices": 0, "updated_prices": 0, "duplicates": 0, "invalid": 0}

        for rec in records:
            trading_date = _trading_date(rec.trading_date)
            if trading_date is None:
                stats["invalid"] += 1
                continue
            outcome = await self.price_repo.upsert(
                company_id=company.id,
                ticker=rec.ticker or company.ticker,
                source=rec.source,
                open=_finite_or_none(rec.open),
                high=_finite_or_none(rec.high),
                low=_finite_or_none(rec.low),
                close=_finite_or_none(rec.close),
                adjusted_close=_finite_or_none(rec.adjusted_close),
                volume=_finite_or_none(rec.volume),
                trading_date=trading_date,
                interval=_INTERVALS.get(rec.interval, PriceInterval.ONE_DAY),
            )
            if outcome == "inserted":
                stats["new_prices"] += 1
            elif outcome == "updated":
                stats["updated_prices"] += 1
            else:
                stats["duplicates"] += 1

        await self.session.commit()
        return stats


def _json_safe(value: Any) -> Any:
    """JSONB cannot store NaN/Inf; numpy scalars become plain floats."""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, float)):
        return value if not isinstance(value, float) or math.isfinite(value) else None
    number = _finite_or_none(value)
    return number if number is not None else str(value)


class FinancialService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = FinancialStatementRepository(session)
        self.ratio_repo = FinancialRatioRepository(session)
        self.analysis_service = AnalysisService(session)

    async def process_financials(self, raw_data: Iterable[RawEventData], company: Company) -> dict[str, int]:
        """Upsert statements per period, then (re)compute ratios once per touched period.

        The caller commits.
        """
        count = 0
        periods: set[str] = set()

        for raw in raw_data:
            payload = raw.raw_payload_json or {}
            statement_type = payload.get("statement_type")
            data = payload.get("data")
            if not statement_type or not isinstance(data, dict):
                continue

            for period, period_data in data.items():
                if not isinstance(period_data, dict):
                    continue
                period_key = str(period).strip()[:20]
                await self.repo.upsert(
                    company_id=company.id,
                    period=period_key,
                    statement_type=str(statement_type)[:50],
                    data_json={str(k): _json_safe(v) for k, v in period_data.items()},
                    currency="TRY",
                )
                count += 1
                periods.add(period_key)

        ratios_calculated = await self.recompute_ratios(company, periods) if periods else 0
        return {
            "financial_records_processed": count,
            "financial_ratios_calculated": ratios_calculated,
        }

    async def recompute_ratios(self, company: Company, periods: Iterable[str] | None = None) -> int:
        """(Re)compute financial_ratios from the stored statements (no network).

        ``periods=None`` recomputes every stored period. The caller commits.
        """
        statements = await self.repo.get_for_company(company.id)
        targets = sorted(set(periods) if periods is not None else {s.period for s in statements})
        written = 0
        for period in targets:
            ratios = self.analysis_service.ratios_from_statements(statements, period, ticker=company.ticker)
            if ratios:
                await self.ratio_repo.upsert(company_id=company.id, period=period, **ratios)
                written += 1
        return written


async def recompute_financial_ratios(session: AsyncSession, ticker: str | None = None) -> dict[str, int]:
    """Recompute stored ratios for one company (``ticker``) or all active companies.

    Idempotent; reads only the statements already in the database.
    """
    from src.db.repository import CompanyRepository

    repo = CompanyRepository(session)
    if ticker:
        company = await repo.get_by_ticker(ticker)
        companies = [company] if company is not None else []
    else:
        companies = list(await repo.get_all())
    service = FinancialService(session)
    written = 0
    for company in companies:
        written += await service.recompute_ratios(company)
        await session.commit()
    logger.info("financial_ratios_recomputed", companies=len(companies), ratios_written=written)
    return {"companies": len(companies), "ratios_written": written}
