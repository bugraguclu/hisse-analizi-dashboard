import math
import re
from collections import Counter
from collections.abc import Iterable, Mapping
from datetime import date, datetime
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import PriceRecord, RawEventData
from src.adapters.kap import disclosure_metadata, event_from_item
from src.core.enums import EventCategory, EventType, Severity
from src.core.time import utcnow
from src.db.models import Company, Source
from src.db.repositories.market import BarUpsertStats, upsert_bars
from src.db.repository import (
    NormalizedEventRepository,
    OutboxRepository,
    PriceDataRepository,
    RawEventRepository,
)
from src.parsers.helpers import clean_whitespace, compute_dedup_key, strip_html

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
# "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim", ...); the summary is the company's
# own headline ("Tahsisli Sermaye Artırımı Kapsamında TTK 461 Raporu Hk."). The form
# name is the more reliable signal, so every rule is tried on the title first and only
# then on the summary (generic forms such as "Özel Durum Açıklaması (Genel)" match no
# rule themselves). Matching runs on a folded form of the text: Turkish-aware lower
# case with diacritics removed ("KARI"/"Karı"/"kari" all become "kari"), so the
# patterns below are written in plain ASCII.

_FOLD_TABLE = str.maketrans({"ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u"})


def fold_turkish(text: str) -> str:
    """Case- and diacritic-insensitive form of Turkish text for keyword matching."""
    lowered = text.replace("İ", "i").replace("I", "ı").lower().replace("̇", "")
    return re.sub(r"\s+", " ", lowered.translate(_FOLD_TABLE)).strip()


def _patterns(*regexes: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(r) for r in regexes)


# A "sözleşme" is a business contract unless it is the articles of association or a
# collective labour agreement.
_CONTRACT = r"(?<!esas )(?<!toplu is )sozlesme"
# Liquidity-provider / market-maker agreements are routine market plumbing, not new
# business, even though their summaries say "sözleşme imzalanması".
_MARKET_MAKING = re.compile(r"likidite saglayici|piyasa yapici")

# Material events -> HIGH (checked first).
HIGH_SEVERITY_PATTERNS = _patterns(
    r"sermaye artirim", r"sermaye azaltim", r"bedelsiz", r"bedelli", r"tahsisli", r"ruchan hakki",
    r"birlesme", r"bolunme", r"devralma", r"satin alma", r"finansal duran varlik (edinim|satis)",
    r"pay alim teklifi",
    r"geri al(im|in)",  # pay geri alımı / geri alınan paylar
    r"kar payi", r"temettu", r"dividend",
    r"iflas", r"konkordato", r"tasfiye",
    r"ihale", r"yeni is iliskisi", r"siparis", _CONTRACT,
    r"\bdava", r"sorusturma", r"suc duyurusu", r"para cezasi",
    # Trading halts, not every sentence about the trading session ("işlem sırasında devre
    # kesici devreye girmiştir" is a routine circuit-breaker notice).
    r"tedbir", r"islem yasagi", r"islem sirasi.{0,40}kapat", r"durdurul", r"kottan cikar", r"borsadan cikar",
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
    r"kayitli sermaye tavani", r"pay sahipligi", r"fiyat istikrari", r"net aktif deger",
    r"yatirimci iliskileri",
    # Takasbank's settlement-default notices list many stock codes at once; routine.
    r"\btemerrut islemi",
)

# First matching category wins, so the order encodes precedence: specific corporate
# actions before the broad governance / market buckets ("Yönetim kurulu eski üyeleri
# hakkında suç duyurusu" is LEGAL, not MANAGEMENT).
CATEGORY_PATTERNS: tuple[tuple[EventCategory, tuple[re.Pattern[str], ...]], ...] = (
    (EventCategory.DIVIDEND, _patterns(r"temettu", r"kar payi", r"dividend", r"mali hak kullanim.*nakit")),
    (EventCategory.SHARE_BUYBACK, _patterns(r"geri al(im|in)")),
    (
        EventCategory.CAPITAL_INCREASE,
        _patterns(
            r"sermaye artirim", r"sermaye artisi", r"sermaye azaltim", r"bedelli", r"bedelsiz", r"tahsisli",
            r"ruchan hakki", r"kayitli sermaye tavani",
        ),
    ),
    (
        EventCategory.MERGER_ACQUISITION,
        _patterns(
            r"birlesme", r"bolunme", r"devralma", r"duran varlik (edinim|satis|alim)", r"pay alim teklifi",
            r"satin alma", r"pay devri", r"hisse devri", r"sirket kurulmasi", r"sirket kurulus",
        ),
    ),
    (
        EventCategory.LEGAL,
        _patterns(
            r"\bdava", r"hukuki", r"para cezasi", r"idari para", r"sorusturma", r"suc duyurusu", r"tedbir",
            r"islem yasagi", r"\bicra\b", r"haciz", r"konkordato", r"iflas", r"tasfiye",
        ),
    ),
    (EventCategory.NEW_BUSINESS, _patterns(r"yeni is", r"\bis iliskisi", r"ihale", r"siparis", _CONTRACT, r"transfer gorusme")),
    (
        EventCategory.FINANCIAL_RESULTS,
        _patterns(
            r"finansal rapor", r"finansal tablo", r"mali tablo", r"bilanco", r"gelir tablosu", r"kar/zarar",
            r"faaliyet raporu", r"sorumluluk beyani", r"finansal takvim", r"gelecege donuk degerlendirme",
        ),
    ),
    (EventCategory.CREDIT_RATING, _patterns(r"kredi derecelendirme", r"derecelendirme notu", r"\brating\b")),
    (
        EventCategory.DEBT_INSTRUMENT,
        _patterns(
            r"borclanma arac", r"pay disinda sermaye piyasasi arac", r"kira sertifika", r"\btahvil", r"\bbono",
            r"ihrac tavani", r"ihrac belgesi", r"tertip ihrac", r"\bitfa", r"kupon", r"varant", r"eurobond",
            r"\bsukuk",
        ),
    ),
    (
        EventCategory.INSIDER_TRADING,
        _patterns(r"pay alim satim bildirimi", r"pay alim bildirimi", r"pay satim bildirimi", r"toptan alis satis", r"pay sahipligi", r"%\s*5"),
    ),
    (EventCategory.GENERAL_ASSEMBLY, _patterns(r"genel kurul")),
    (
        EventCategory.MANAGEMENT,
        _patterns(
            r"yonetim kurulu", r"\batama", r"istifa", r"genel mudur", r"komite", r"kurumsal yonetim",
            r"bagimsiz denetim kurulus", r"yatirimci iliskileri", r"gorev dagilim", r"imza yetki",
        ),
    ),
    (
        EventCategory.MARKET_NOTICE,
        _patterns(
            r"devre kesici", r"\bbist\b.*endeks", r"endeks(lerde| sirketlerinde|ine dahil|e dahil)", r"bistech",
            r"\bviop\b", r"temerrut", r"kamuyu aydinlatma platformu duyurusu", r"merkezi kayit kurulusu",
            r"borsa istanbul a\.?s\.? duyurusu", r"borsa duyurusu", r"islem goren tipe donusum", r"islem sirasi",
            r"brut takas", r"kredili islem", r"aciga satis", r"fiili dolasim", r"piyasa yapici", r"likidite saglayici",
            r"olagan disi fiyat", r"fiyat istikrari", r"net aktif deger",
        ),
    ),
)

_MAX_TITLE = 1000
_MAX_URL = 1000


def _classification_texts(title: str | None, summary: str | None) -> tuple[str, ...]:
    """Folded title, then the folded summary when it says something the title does not."""
    title_text = fold_turkish(title or "")
    summary_text = fold_turkish(summary or "")
    if not summary_text or summary_text == title_text:
        return (title_text,) if title_text else ()
    return (title_text, summary_text) if title_text else (summary_text,)


def classify_category(title: str | None, summary: str | None = None) -> EventCategory:
    """Keyword-based category: the form name decides when a rule matches it, else the summary."""
    for text in _classification_texts(title, summary):
        if _MARKET_MAKING.search(text):
            return EventCategory.MARKET_NOTICE
        for category, patterns in CATEGORY_PATTERNS:
            if any(p.search(text) for p in patterns):
                return category
    return EventCategory.OTHER


def classify_severity(title: str | None, summary: str | None, source_code: str) -> Severity:
    """Material events -> HIGH, boilerplate filings -> INFO, otherwise the source default.

    HIGH wins when either the form name or the summary is material (a general-meeting
    notice announcing a dividend is HIGH); INFO needs a boilerplate match and no material one.
    """
    texts = _classification_texts(title, summary)
    high = HIGH_SEVERITY_PATTERNS
    if any(_MARKET_MAKING.search(text) for text in texts):
        high = tuple(p for p in high if p.pattern != _CONTRACT)
    if any(p.search(text) for text in texts for p in high):
        return Severity.HIGH
    if any(p.search(text) for text in texts for p in INFO_SEVERITY_PATTERNS):
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


_MAX_EXCERPT = 500


async def enrich_kap_events(session: AsyncSession, items: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """Bring stored KAP events up to date with KAP list items and re-classify them.

    Events stored before the list endpoint was used only carry the form name; this adds
    the KAP summary (``excerpt``), display metadata (publisher, correction flag, …) and the
    severity/category that the richer text yields. Rows are matched on the disclosure URL
    (every company row of a multi-company disclosure). Idempotent; the caller commits.
    """
    by_url: dict[str, RawEventData] = {}
    for item in items:
        event = event_from_item(item)
        if event is not None and event.canonical_url:
            by_url[event.canonical_url] = event
    repo = NormalizedEventRepository(session)
    stats = {"disclosures": len(by_url), "matched": 0, "updated": 0}
    urls = list(by_url)
    for start in range(0, len(urls), 500):
        changes: list[dict[str, Any]] = []
        for row in await repo.get_enrichment_rows(urls[start : start + 500]):
            event = by_url.get(row.event_url or "")
            if event is None:
                continue
            stats["matched"] += 1
            excerpt = clean_whitespace(event.summary)[:_MAX_EXCERPT] or row.excerpt
            metadata = {**(row.metadata_json or {}), **disclosure_metadata(event.raw_payload_json)}
            severity = classify_severity(row.title, excerpt, row.source_code)
            category = classify_category(row.title, excerpt)
            if (excerpt, metadata, severity, category) == (row.excerpt, row.metadata_json, row.severity, row.category):
                continue
            changes.append(
                {"id": row.id, "excerpt": excerpt, "metadata_json": metadata, "severity": severity, "category": category}
            )
        await repo.bulk_update_events(changes)
        stats["updated"] += len(changes)
    logger.info("kap_events_enriched", **stats)
    return stats


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
            metadata: dict[str, Any] = disclosure_metadata(event_data.raw_payload_json) if source_code == "kap" else {}
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
                excerpt=clean_whitespace(event_data.summary)[:_MAX_EXCERPT] if event_data.summary else None,
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


_INTERVALS = {"1d", "1h", "15m"}
# Historical adapter source codes → provider codes stored in price_bars.
_BAR_SOURCES = {"borsapy": "tradingview"}


def price_rows(records: Iterable[PriceRecord], company: Company) -> tuple[list[dict[str, Any]], int]:
    """Legacy ``PriceRecord`` list → ``price_bars`` rows (+ the number of unusable records).

    ``PriceAdapter`` only emits completed sessions, so the rows are final. NaN/Inf
    never reach the NUMERIC columns.
    """
    rows: list[dict[str, Any]] = []
    invalid = 0
    for rec in records:
        trading_date = _trading_date(rec.trading_date)
        if trading_date is None:
            invalid += 1
            continue
        rows.append(
            {
                "company_id": company.id,
                "symbol": rec.ticker or company.ticker,
                "source": _BAR_SOURCES.get(rec.source, rec.source),
                "open": _finite_or_none(rec.open),
                "high": _finite_or_none(rec.high),
                "low": _finite_or_none(rec.low),
                "close": _finite_or_none(rec.close),
                "volume": _finite_or_none(rec.volume),
                "bar_date": trading_date,
                "interval": rec.interval if rec.interval in _INTERVALS else "1d",
                "adjusted": True,
                "is_final": True,
            }
        )
    return rows, invalid


class PriceService:
    """Legacy per-company price poll (``polling_worker`` source ``price``).

    A thin wrapper over the market store's bar upsert
    (:func:`src.db.repositories.market.upsert_bars`): same provider precedence as
    the market worker, so the legacy TradingView/Yahoo rows can never override a
    newer canonical bar.
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self.price_repo = PriceDataRepository(session)

    async def process_prices(
        self,
        records: list[PriceRecord],
        company: Company,
    ) -> dict[str, int]:
        """Upsert OHLCV rows in one statement and commit."""
        rows, invalid = price_rows(records, company)
        stats = await upsert_bars(self.session, rows) if rows else BarUpsertStats()
        await self.session.commit()
        return {
            "new_prices": stats.inserted,
            "updated_prices": stats.updated,
            "duplicates": stats.unchanged,
            "invalid": invalid,
        }


class FinancialService:
    """Legacy polling source ``financials`` → the fundamentals store.

    A thin wrapper over :func:`src.services.fundamentals_service.refresh_company_statements`
    (KAP summary + İş Yatırım quarterly tables → ``financial_statements``,
    ``financial_facts`` and ``financial_ratios``) — the same code path as the
    fundamentals worker, gated by the refresh cadence so the hourly legacy poll
    does not re-fetch fresh companies. It opens its own short sessions (no
    connection is held while the providers answer); ``session`` is used by
    :meth:`recompute_ratios` only.
    """

    def __init__(self, session: AsyncSession):
        self.session = session

    async def process_financials(self, raw_data: Iterable[RawEventData], company: Company) -> dict[str, int]:
        """Refresh ``company`` when due (``raw_data`` is the adapter's refresh marker)."""
        from datetime import timedelta

        from src.core.config import settings
        from src.services.fundamentals_service import refresh_company_statements

        hours = (
            settings.fundamentals_refresh_core_hours
            if company.tracking_tier == "core"
            else settings.fundamentals_refresh_universe_hours
        )
        result = await refresh_company_statements(company.ticker, max_age=timedelta(hours=hours))
        if not result.ok:
            raise RuntimeError(result.kap_error or result.isy_error or "fundamentals refresh failed")
        return {
            "financial_records_processed": result.statements.changed if result.statements else 0,
            "financial_ratios_calculated": result.ratios,
        }

    async def recompute_ratios(self, company: Company, periods: Iterable[str] | None = None) -> int:
        """(Re)compute ``financial_ratios`` from the stored facts (no statement fetch).

        ``periods`` is accepted for compatibility; every period is recomputed. The
        caller commits.
        """
        from src.services.fundamentals_service import compute_company_ratios, load_market_inputs

        market = (await load_market_inputs([company.ticker], session=self.session)).get(company.ticker)
        return await compute_company_ratios(self.session, company, market)


async def recompute_financial_ratios(session: AsyncSession, ticker: str | None = None) -> dict[str, int]:
    """Recompute stored ratios for one company (``ticker``) or every company with facts.

    Idempotent; reads the stored facts (no statement fetch) and today's prices.
    """
    from src.services.fundamentals_service import recompute_ratios

    summary = await recompute_ratios([ticker] if ticker else None)
    logger.info("financial_ratios_recomputed", companies=summary["companies"], ratios_written=summary["ratios_written"])
    return {"companies": int(summary["companies"]), "ratios_written": int(summary["ratios_written"])}
