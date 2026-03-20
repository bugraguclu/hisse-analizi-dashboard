import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.enums import Severity
from src.db.session import get_db
from src.db.models import (
    Company,
    Source,
    NormalizedEvent,
    RawEvent,
    PriceData,
    EventOutbox,
    Notification,
    PollingState,
    FinancialStatement,
)
from src.db.repository import (
    CompanyRepository,
    SourceRepository,
    NormalizedEventRepository,
    PriceDataRepository,
    OutboxRepository,
    NotificationRepository,
    NotificationRuleRepository,
    PollingStateRepository,
    FinancialStatementRepository,
)
from src.schemas.events import (
    HealthOut,
    CompanyOut,
    SourceOut,
    EventOut,
    EventDetailOut,
    PriceOut,
    OutboxOut,
    NotificationOut,
    NotificationRuleCreate,
    PollingStateOut,
    PollRunRequest,
    BackfillRequest,
    StatsOut,
    FinancialStatementOut,
)
from src.workers.polling_worker import poll_source, run_all_sources_once
from src.workers.notification_worker import process_notifications_once

DB = Annotated[AsyncSession, Depends(get_db)]

router = APIRouter()
admin_router = APIRouter(prefix="/admin", tags=["admin"])


# --- Public Endpoints ---

@router.get("/health", response_model=HealthOut)
async def health():
    return HealthOut(environment=settings.app_env)


@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(db: DB):
    repo = CompanyRepository(db)
    return await repo.get_all()


@router.get("/companies/{ticker}", response_model=CompanyOut)
async def get_company(ticker: str, db: DB):
    repo = CompanyRepository(db)
    company = await repo.get_by_ticker(ticker.upper())
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(db: DB):
    repo = SourceRepository(db)
    return await repo.get_all()


@router.get("/events", response_model=list[EventOut])
async def list_events(
    db: DB,
    source_code: str | None = None,
    event_type: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    repo = NormalizedEventRepository(db)
    return await repo.get_list(
        source_code=source_code,
        event_type=event_type,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )


@router.get("/events/latest", response_model=list[EventOut])
async def latest_events(db: DB):
    repo = NormalizedEventRepository(db)
    return await repo.get_latest()


@router.get("/events/{event_id}", response_model=EventDetailOut)
async def get_event(event_id: uuid.UUID, db: DB):
    repo = NormalizedEventRepository(db)
    event = await repo.get_by_id(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.get("/prices", response_model=list[PriceOut])
async def list_prices(
    db: DB,
    ticker: str = Query(..., description="Company ticker symbol"),
    since: str | None = None,
    until: str | None = None,
    interval: str = "1d",
    limit: int = Query(default=100, le=500),
):
    repo = PriceDataRepository(db)
    return await repo.get_list(ticker=ticker.upper(), since=since, until=until, interval=interval, limit=limit)


@router.get("/prices/latest", response_model=PriceOut | None)
async def latest_price(db: DB, ticker: str = Query(..., description="Company ticker symbol")):
    repo = PriceDataRepository(db)
    return await repo.get_latest(ticker.upper())


@router.get("/financials", response_model=list[FinancialStatementOut])
async def list_financials(db: DB, ticker: str = Query(..., description="Company ticker symbol")):
    company_repo = CompanyRepository(db)
    company = await company_repo.get_by_ticker(ticker.upper())
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    repo = FinancialStatementRepository(db)
    return await repo.get_for_company(company.id)


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(db: DB):
    repo = NotificationRepository(db)
    return await repo.get_all()


@router.get("/outbox", response_model=list[OutboxOut])
async def list_outbox(db: DB):
    repo = OutboxRepository(db)
    return await repo.get_all()


@router.get("/polling-state", response_model=list[PollingStateOut])
async def list_polling_state(db: DB):
    repo = PollingStateRepository(db)
    return await repo.get_all()


# --- Admin Endpoints ---

@admin_router.post("/poll/run-once", status_code=202)
async def run_poll_once(body: PollRunRequest, background_tasks: BackgroundTasks):
    if body.source_code:
        background_tasks.add_task(poll_source, body.source_code)
    else:
        background_tasks.add_task(run_all_sources_once)
    return {"status": "accepted", "source_code": body.source_code or "all"}


@admin_router.post("/backfill", status_code=202)
async def backfill(body: BackfillRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_all_sources_once)
    return {"status": "accepted", "days": body.days, "source_code": body.source_code or "all"}


@admin_router.post("/notification-rules")
async def create_notification_rule(body: NotificationRuleCreate, db: DB):
    company_repo = CompanyRepository(db)
    company = await company_repo.get_by_ticker(body.company_ticker.upper())
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    rule_repo = NotificationRuleRepository(db)
    rule = await rule_repo.create(
        company_id=company.id,
        email=body.email,
        min_severity=body.min_severity,
        source_filters=body.source_filters,
    )
    await db.commit()
    return {"id": str(rule.id), "email": rule.email, "status": "created"}


@admin_router.post("/notifications/test-send")
async def test_notification(background_tasks: BackgroundTasks):
    background_tasks.add_task(process_notifications_once)
    return {"status": "accepted"}


@admin_router.get("/stats", response_model=StatsOut)
async def get_stats(db: DB):
    raw_count = (await db.execute(select(func.count(RawEvent.id)))).scalar() or 0
    norm_count = (await db.execute(select(func.count(NormalizedEvent.id)))).scalar() or 0
    price_count = (await db.execute(select(func.count(PriceData.id)))).scalar() or 0
    notif_count = (await db.execute(select(func.count(Notification.id)))).scalar() or 0
    financial_count = (await db.execute(select(func.count(FinancialStatement.id)))).scalar() or 0
    pending_outbox = (
        await db.execute(
            select(func.count(EventOutbox.id)).where(EventOutbox.status == "pending")
        )
    ).scalar() or 0

    # --- Public Endpoints ---

    # Events summary by company and category
    events_by_company = (
        await db.execute(
            select(Company.ticker, func.count(NormalizedEvent.id))
            .join(NormalizedEvent)
            .group_by(Company.ticker)
        )
    ).all()
    
    events_by_category = (
        await db.execute(
            select(NormalizedEvent.category, func.count(NormalizedEvent.id))
            .group_by(NormalizedEvent.category)
        )
    ).all()

    return StatsOut(
        total_raw_events=raw_count,
        total_normalized_events=norm_count,
        total_price_records=price_count,
        total_notifications=notif_count,
        total_financial_records=financial_count,
        pending_outbox=pending_outbox,
    )
