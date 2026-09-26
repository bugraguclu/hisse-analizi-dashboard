import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated, Any, TypeVar

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.kap import CONTENT_FORMAT_VERSION, KapUnavailableError, disclosure_id, fetch_disclosure_content
from src.api.dependencies import require_admin, validate_ticker
from src.api.limiter import limiter
from src.core.config import settings
from src.core.enums import EventType, PriceInterval, parse_event_category, parse_severity
from src.core.meta import DataMeta
from src.core.time import to_utc, utcnow
from src.db.models import Company
from src.db.repository import (
    CompanyRepository,
    EventFilters,
    EventSort,
    NormalizedEventRepository,
    NotificationRepository,
    NotificationRuleRepository,
    OutboxRepository,
    PollingStateRepository,
    PriceDataRepository,
    SourceRepository,
    StatsRepository,
)
from src.db.session import check_database, get_db
from src.services import market_service
from src.schemas.events import (
    BackfillAcceptedOut,
    BackfillRequest,
    CompanyOut,
    EventContentOut,
    EventDetailOut,
    EventFacetsOut,
    EventOut,
    FinancialRatioOut,
    FinancialStatementOut,
    HealthOut,
    NotificationOut,
    NotificationRuleCreate,
    NotificationRuleOut,
    OutboxOut,
    PollAcceptedOut,
    PollingStateOut,
    PollRunRequest,
    PriceOut,
    ReclassifyOut,
    ReclassifyRequest,
    RecomputeRatiosOut,
    RecomputeRatiosRequest,
    SourceOut,
    StatementType,
    StatsOut,
    TaskAcceptedOut,
)

DB = Annotated[AsyncSession, Depends(get_db)]
logger = structlog.get_logger(__name__)

logger = structlog.get_logger(__name__)

router = APIRouter()
admin_router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)

T = TypeVar("T")

COMPANY_NOT_FOUND = "Şirket bulunamadı."
EVENT_NOT_FOUND = "Olay bulunamadı."
HEALTH_DB_TIMEOUT_SECONDS = 2.0


def _optional_ticker(ticker: str | None) -> str | None:
    return validate_ticker(ticker) if ticker and ticker.strip() else None


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def _company_or_404(db: AsyncSession, ticker: str) -> Company:
    company = await CompanyRepository(db).get_by_ticker(validate_ticker(ticker))
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=COMPANY_NOT_FOUND)
    return company


# --- System ---

def _health(db_ok: bool) -> HealthOut:
    return HealthOut(
        status="ok" if db_ok else "degraded",
        environment=settings.app_env,
        database="ok" if db_ok else "unavailable",
    )


@router.get("/health", response_model=HealthOut, tags=["system"])
async def health() -> HealthOut:
    """Liveness + diagnostics: always HTTP 200 while the process runs.

    ``status`` is ``degraded`` (and ``database`` ``unavailable``) when PostgreSQL does
    not answer ``SELECT 1`` within 2 s. Use ``/health/ready`` for readiness probes.
    """
    return _health(await check_database(HEALTH_DB_TIMEOUT_SECONDS))


@router.get(
    "/health/ready",
    response_model=HealthOut,
    tags=["system"],
    responses={503: {"model": HealthOut, "description": "Veritabanına ulaşılamıyor"}},
)
async def readiness(response: Response) -> HealthOut:
    """Readiness probe: HTTP 503 while the database is unreachable."""
    db_ok = await check_database(HEALTH_DB_TIMEOUT_SECONDS)
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return _health(db_ok)


@router.get("/stats", response_model=StatsOut, tags=["system"])
async def get_stats(db: DB) -> StatsOut:
    return StatsOut(**await StatsRepository(db).get_counts())


# --- Public Endpoints ---

@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(
    db: DB,
    tier: Annotated[
        str, Query(pattern="^(core|universe|all)$", description="core (BIST 100, varsayılan), universe veya all")
    ] = "core",
    include_inactive: Annotated[bool, Query(description="Borsadan çıkarılmış/askıya alınmış şirketleri de listele")] = False,
):
    return await CompanyRepository(db).get_all(None if tier == "all" else tier, include_inactive=include_inactive)


@router.get("/companies/{ticker}", response_model=CompanyOut)
async def get_company(ticker: str, db: DB):
    return await _company_or_404(db, ticker)


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(db: DB):
    return await SourceRepository(db).get_all()


TOTAL_COUNT_HEADER = "X-Total-Count"
MAX_TICKER_FILTER = 50
# Content views are the only /events calls that can reach KAP; keep them polite.
CONTENT_RATE_LIMIT = "30/minute"
CONTENT_UNAVAILABLE = "Bildirim içeriği şu an KAP'tan alınamadı. Lütfen biraz sonra tekrar deneyin."
_MAX_BODY_TEXT = 20_000


def _parse_list(raw: str | None, parse: Callable[[str], T | None], error: str) -> list[T]:
    """Comma-separated, de-duplicated values; any unknown value -> 400."""
    values: list[T] = []
    for item in (raw or "").split(","):
        if not item.strip():
            continue
        parsed = parse(item)
        if parsed is None:
            raise _bad_request(error)
        if parsed not in values:
            values.append(parsed)
    return values


def _parse_tickers(raw: str | None) -> list[str]:
    tickers = _parse_list(raw, validate_ticker, "Geçersiz hisse kodu.")
    if len(tickers) > MAX_TICKER_FILTER:
        raise _bad_request(f"En fazla {MAX_TICKER_FILTER} hisse kodu ile filtrelenebilir.")
    return tickers


def event_filters(
    source_code: Annotated[str | None, Query(max_length=50, description="Kaynak kodu (ör. kap)")] = None,
    event_type: EventType | None = None,
    ticker: Annotated[
        str | None,
        Query(max_length=600, description="Tam eşleşen hisse kodu/kodları, virgülle en fazla 50 (ör. THYAO,GARAN)"),
    ] = None,
    category: Annotated[
        str | None,
        Query(
            max_length=300,
            description="Kategori; değer (temettü) veya ad (DIVIDEND), büyük/küçük harf duyarsız, virgülle birden fazla",
        ),
    ] = None,
    severity: Annotated[
        str | None,
        Query(max_length=50, description="Önem: INFO, WATCH, HIGH (büyük/küçük harf duyarsız, virgülle birden fazla)"),
    ] = None,
    since: Annotated[
        datetime | None,
        Query(description="Bu andan itibaren (dahil), ISO 8601. Saat dilimi yoksa Europe/Istanbul kabul edilir."),
    ] = None,
    until: Annotated[
        datetime | None,
        Query(description="Bu ana kadar (dahil), ISO 8601. Saat dilimi yoksa Europe/Istanbul kabul edilir."),
    ] = None,
    search: Annotated[
        str | None,
        Query(
            min_length=2,
            max_length=100,
            description="Başlık, KAP özeti ve şirket adında arama; hisse kodu önekinde eşleşme",
        ),
    ] = None,
) -> EventFilters:
    """Filters shared by ``/events`` and ``/events/facets``."""
    since_utc = to_utc(since, settings.tz) if since else None
    until_utc = to_utc(until, settings.tz) if until else None
    if since_utc and until_utc and since_utc > until_utc:
        raise _bad_request("'since' değeri 'until' değerinden sonra olamaz.")
    return EventFilters(
        source_code=source_code.strip() if source_code and source_code.strip() else None,
        event_type=event_type,
        tickers=_parse_tickers(ticker),
        categories=_parse_list(category, parse_event_category, "Geçersiz kategori."),
        severities=_parse_list(severity, parse_severity, "Geçersiz önem düzeyi (INFO, WATCH, HIGH)."),
        since=since_utc,
        until=until_utc,
        search=search,
    )


Filters = Annotated[EventFilters, Depends(event_filters)]


@router.get("/events", response_model=list[EventOut])
async def list_events(
    db: DB,
    response: Response,
    filters: Filters,
    sort: Annotated[
        EventSort,
        Query(description="newest (varsayılan), oldest, severity (önce yüksek), ticker (A→Z)"),
    ] = "newest",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
):
    """KAP disclosures, one row per disclosure (a disclosure that concerns several tracked
    companies lists all of them in ``tickers``). The number of matching disclosures
    (ignoring limit/offset) is returned in the ``X-Total-Count`` header."""
    repo = NormalizedEventRepository(db)
    events = await repo.get_page(filters, sort=sort, limit=limit, offset=offset)
    total = len(events) + offset if len(events) < limit and (events or offset == 0) else await repo.count(filters)
    response.headers[TOTAL_COUNT_HEADER] = str(total)
    return events


@router.get("/events/latest", response_model=list[EventOut])
async def latest_events(db: DB, limit: Annotated[int, Query(ge=1, le=50)] = 10):
    return await NormalizedEventRepository(db).get_latest(limit=limit)


@router.get("/events/facets", response_model=EventFacetsOut)
async def event_facets(
    db: DB,
    filters: Filters,
    ticker_facet: Annotated[
        str | None,
        Query(
            max_length=600,
            description="Sayısı istenen hisse kodları, virgülle en fazla 50 (filtre panelindeki seçenekler)",
        ),
    ] = None,
) -> EventFacetsOut:
    """Disclosure counts per category, severity and (asked-for) ticker for the current
    filters (for the filter bar): each facet ignores its own filter, ``total`` applies
    all of them."""
    facets = await NormalizedEventRepository(db).facets(filters, tickers=_parse_tickers(ticker_facet))
    return EventFacetsOut(
        total=facets.total, categories=facets.categories, severities=facets.severities, tickers=facets.tickers
    )


@router.get("/events/{event_id}", response_model=EventDetailOut)
async def get_event(event_id: uuid.UUID, db: DB):
    event = await NormalizedEventRepository(db).get_by_id(event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=EVENT_NOT_FOUND)
    return event


def _content_out(event_id: uuid.UUID, source_url: str | None, content: dict[str, Any], fetched_at: datetime) -> EventContentOut:
    return EventContentOut.model_validate(
        {
            "event_id": event_id,
            "source_url": source_url,
            "blocks": content.get("blocks") or [],
            "attachments": content.get("attachments") or [],
            "truncated": bool(content.get("truncated")),
            "fetched_at": fetched_at,
        }
    )


def _blocks_to_text(blocks: list[dict[str, Any]]) -> str:
    """Plain-text rendition of content blocks (``body_text``, shown by simpler clients)."""
    parts: list[str] = []
    for block in blocks:
        if block["type"] in ("heading", "text"):
            parts.append(block["text"])
        elif block["type"] == "field":
            parts.append(f"{block['label']}: {block['value']}")
        elif block["type"] == "table":
            parts.append("\n".join(" | ".join(cell for cell in row) for row in block["rows"]))
    return "\n\n".join(parts)[:_MAX_BODY_TEXT]


@router.get(
    "/events/{event_id}/content",
    response_model=EventContentOut,
    responses={503: {"description": "KAP'a şu an ulaşılamıyor (code: upstream_unavailable)"}},
)
@limiter.limit(CONTENT_RATE_LIMIT)
async def get_event_content(request: Request, event_id: uuid.UUID, db: DB):
    """Full text of a KAP disclosure as display blocks. Fetched from KAP on the first view
    and cached on every company row of the disclosure."""
    repo = NormalizedEventRepository(db)
    event = await repo.get_by_id(event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=EVENT_NOT_FOUND)
    cached = await repo.get_content(event_id)
    if cached is not None and cached[0] is not None and cached[1] is not None and cached[0].get("v") == CONTENT_FORMAT_VERSION:
        return _content_out(event_id, event.event_url, cached[0], cached[1])

    index = disclosure_id(event.event_url or "") if event.source_code == "kap" else None
    if index is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bu olay için bildirim içeriği yok.")
    try:
        content = await fetch_disclosure_content(index)
    except KapUnavailableError as e:
        logger.warning("kap_content_unavailable", event_id=str(event_id), index=index, error=str(e))
        return JSONResponse(
            {"detail": CONTENT_UNAVAILABLE, "code": "upstream_unavailable"},
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers={"Retry-After": "60"},
        )
    payload = content.to_json()
    fetched_at = utcnow()
    await repo.save_content(
        event.event_url or "",
        payload,
        _blocks_to_text(payload["blocks"]) or None,
        fetched_at,
        summary=content.summary,
    )
    await db.commit()
    return _content_out(event_id, event.event_url, payload, fetched_at)


class PriceLatestOut(PriceOut):
    """``/prices/latest`` row + the additive provenance block (docs/data-platform.md §4.2)."""

    meta: dict[str, Any] | None = None


async def _refresh_daily_store(symbol: str, interval: PriceInterval) -> DataMeta | None:
    """Store-first: make sure the stored daily series is current (live top-up + write-through).

    Failures never break the endpoint — it keeps answering from whatever is stored.
    """
    if interval != PriceInterval.ONE_DAY:
        return None  # intraday bars are not stored (always empty unless legacy rows exist)
    try:
        return (await market_service.get_daily_bars(symbol)).meta
    except Exception as e:  # provider down and nothing stored, unknown symbol, ...
        logger.warning("prices_store_refresh_failed", ticker=symbol, error=f"{type(e).__name__}: {e}"[:200])
        return None


def _meta_headers(response: Response, meta: DataMeta | None) -> None:
    """List responses cannot carry a ``meta`` object without breaking their shape: use headers."""
    if meta is None:
        return
    response.headers["X-Data-Source"] = meta.source
    response.headers["X-Data-Served-From"] = meta.served_from
    response.headers["X-Data-Stale"] = "true" if meta.stale else "false"
    if meta.as_of:
        response.headers["X-Data-As-Of"] = meta.as_of
    if meta.delay_seconds is not None:
        response.headers["X-Data-Delay-Seconds"] = str(meta.delay_seconds)


@router.get("/prices", response_model=list[PriceOut])
async def list_prices(
    db: DB,
    response: Response,
    ticker: str = "THYAO",
    since: date | None = None,
    until: date | None = None,
    interval: PriceInterval = PriceInterval.ONE_DAY,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    """Stored OHLCV rows (market store), newest first, one row per trading date.

    Daily bars are store-first: a stale or missing series is topped up from
    TradingView before answering. Provenance is in the ``X-Data-*`` headers.
    """
    company = await _company_or_404(db, ticker)
    if since and until and since > until:
        raise _bad_request("'since' değeri 'until' değerinden sonra olamaz.")
    _meta_headers(response, await _refresh_daily_store(company.ticker, interval))
    return await PriceDataRepository(db).get_list(
        ticker=company.ticker, since=since, until=until, interval=interval, limit=limit
    )


@router.get("/prices/latest", response_model=PriceLatestOut | None)
async def latest_price(
    db: DB, response: Response, ticker: str = "THYAO", interval: PriceInterval = PriceInterval.ONE_DAY
):
    """Latest stored row (store-first, + ``meta``); ``null`` when the company has no price data yet."""
    company = await _company_or_404(db, ticker)
    meta = await _refresh_daily_store(company.ticker, interval)
    _meta_headers(response, meta)
    row = await PriceDataRepository(db).get_latest(company.ticker, interval=interval)
    if row is None:
        return None
    payload = PriceLatestOut.model_validate(row)
    payload.meta = meta.to_dict() if meta is not None else None
    return payload


@router.get("/financials", response_model=list[FinancialStatementOut])
async def list_financials(
    db: DB,
    response: Response,
    ticker: str = Query(..., description="Hisse kodu (orn: THYAO)"),
    statement_type: StatementType | None = Query(None, description="balance_sheet | income_stmt | cash_flow"),
    source: str | None = Query(
        None, pattern="^(kap|isyatirim)$", description="kap (ilk açıklanan) | isyatirim (boşsa ikisi)"
    ),
):
    """Stored statements, newest period first: KAP (first published) and İş Yatırım rows.

    Store-first: refreshed from the providers when older than
    ``FUNDAMENTALS_MAX_AGE_STATEMENTS_HOURS``; the stored rows are returned when the
    providers fail. Provenance/freshness (``meta``) is in the ``X-Data-Meta`` header
    (the body stays a list).
    """
    from src.services.fundamentals_service import DATA_META_HEADER, meta_header, statements_for_api

    company = await _company_or_404(db, ticker)
    rows, meta = await statements_for_api(db, company, statement_type=statement_type, source=source)
    response.headers[DATA_META_HEADER] = meta_header(meta)
    return rows


@router.get("/financials/ratios", response_model=list[FinancialRatioOut])
async def list_ratios(
    db: DB,
    response: Response,
    ticker: str = Query(..., description="Hisse kodu (orn: THYAO)"),
    basis: str | None = Query(None, pattern="^(ttm|annual)$", description="ttm | annual (boşsa ikisi)"),
):
    """Stored ratios per period: ``basis=ttm`` (last four quarters) and ``annual`` (fiscal years).

    Valuation multiples use the latest price and only appear on the newest row of
    each basis. Recomputed when older than ``FUNDAMENTALS_MAX_AGE_RATIOS_HOURS``;
    ``meta`` is in the ``X-Data-Meta`` header.
    """
    from src.services.fundamentals_service import DATA_META_HEADER, meta_header, ratios_for_api

    company = await _company_or_404(db, ticker)
    rows, meta = await ratios_for_api(db, company, basis=basis)
    response.headers[DATA_META_HEADER] = meta_header(meta)
    return rows


@router.get("/notifications", response_model=list[NotificationOut], dependencies=[Depends(require_admin)])
async def list_notifications(db: DB, limit: Annotated[int, Query(ge=1, le=200)] = 50):
    """Recent notifications (recipient addresses are masked)."""
    return await NotificationRepository(db).get_all(limit=limit)


@router.get("/outbox", response_model=list[OutboxOut], dependencies=[Depends(require_admin)])
async def list_outbox(db: DB, limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return await OutboxRepository(db).get_all(limit=limit)


@router.get("/polling-state", response_model=list[PollingStateOut])
async def list_polling_state(db: DB):
    return await PollingStateRepository(db).get_all()


# --- Admin Endpoints (protected by require_admin, rate limited per client) ---

@admin_router.post("/poll/run-once", status_code=status.HTTP_202_ACCEPTED, response_model=PollAcceptedOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def run_poll_once(request: Request, body: PollRunRequest, background_tasks: BackgroundTasks):
    from src.workers.polling_worker import poll_source, run_all_sources_once

    if body.source_code:
        background_tasks.add_task(poll_source, body.source_code)
    else:
        background_tasks.add_task(run_all_sources_once)
    return PollAcceptedOut(source_code=body.source_code or "all")


@admin_router.post("/backfill", status_code=status.HTTP_202_ACCEPTED, response_model=BackfillAcceptedOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def backfill(request: Request, body: BackfillRequest, background_tasks: BackgroundTasks):
    from src.workers.polling_worker import run_backfill

    background_tasks.add_task(run_backfill, body.days, body.source_code)
    return BackfillAcceptedOut(days=body.days, source_code=body.source_code or "all")


@admin_router.post("/notification-rules", status_code=status.HTTP_201_CREATED, response_model=NotificationRuleOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def create_notification_rule(request: Request, body: NotificationRuleCreate, db: DB):
    company = await _company_or_404(db, body.company_ticker)
    rule = await NotificationRuleRepository(db).create(
        company_id=company.id,
        email=body.email,
        min_severity=body.min_severity,
        source_filters=body.source_filters,
    )
    await db.commit()
    return NotificationRuleOut(
        id=rule.id,
        email=rule.email,
        company_ticker=company.ticker,
        min_severity=body.min_severity,
        source_filters=body.source_filters,
    )


@admin_router.post("/notifications/test-send", status_code=status.HTTP_202_ACCEPTED, response_model=TaskAcceptedOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def test_notification(request: Request, background_tasks: BackgroundTasks):
    from src.workers.notification_worker import process_notifications_once

    background_tasks.add_task(process_notifications_once)
    return TaskAcceptedOut()


@admin_router.post("/events/reclassify", response_model=ReclassifyOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def reclassify_events(request: Request, db: DB, body: ReclassifyRequest | None = None):
    """Re-run severity/category classification on stored events (idempotent).

    ``dry_run`` (default true) only reports what would change.
    """
    from src.services.event_service import reclassify_events as run_reclassification

    dry_run = body.dry_run if body is not None else True
    return await run_reclassification(db, dry_run=dry_run)


@admin_router.post("/financials/recompute-ratios", response_model=RecomputeRatiosOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def recompute_ratios(request: Request, db: DB, body: RecomputeRatiosRequest | None = None):
    """Recompute ``financial_ratios`` from the stored facts (idempotent; no statement fetch,
    one TradingView scanner request for the prices)."""
    from src.services.event_service import recompute_financial_ratios

    ticker = body.ticker if body is not None else None
    if ticker is not None:
        await _company_or_404(db, ticker)
    return await recompute_financial_ratios(db, ticker=ticker)


@admin_router.post("/financials/refresh", status_code=status.HTTP_202_ACCEPTED, response_model=TaskAcceptedOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def refresh_financials(
    request: Request, db: DB, background_tasks: BackgroundTasks, body: RecomputeRatiosRequest | None = None
):
    """Run the fundamentals jobs in the background: statements (KAP + İş Yatırım) → facts → ratios.

    With ``ticker`` that company is refreshed now; without it, the next batch of due
    companies (``FUNDAMENTALS_BATCH_SIZE``; KAP pages are rate limited).
    """
    from src.workers.fundamentals_worker import run_fundamentals_once

    ticker = body.ticker if body is not None else None
    if ticker is not None:
        await _company_or_404(db, ticker)
        background_tasks.add_task(run_fundamentals_once, [ticker])
    else:
        background_tasks.add_task(run_fundamentals_once, None, limit=max(1, settings.fundamentals_batch_size))
    return TaskAcceptedOut()


@admin_router.post("/financials/rebuild", status_code=status.HTTP_202_ACCEPTED, response_model=TaskAcceptedOut)
@limiter.limit(lambda: settings.rate_limit_admin)
async def rebuild_financials(
    request: Request, db: DB, background_tasks: BackgroundTasks, body: RecomputeRatiosRequest | None = None
):
    """Re-derive facts and ratios offline from the stored statements (no provider calls).

    Use after a mapping/restatement rule change; with ``ticker`` only that company.
    """
    from src.services.fundamentals_service import rebuild_all_from_store

    ticker = body.ticker if body is not None else None
    if ticker is not None:
        await _company_or_404(db, ticker)
        background_tasks.add_task(rebuild_all_from_store, [ticker])
    else:
        background_tasks.add_task(rebuild_all_from_store, None)
    return TaskAcceptedOut()
