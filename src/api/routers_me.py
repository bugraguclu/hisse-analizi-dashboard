"""Anonymous-device API: Web Push subscriptions and alert rules (``/push``, ``/me/...``).

Authentication is the device key in ``X-Device-Key`` (see src/core/device.py); the
server stores only its hash. Reads with an unknown key return empty results and
never create rows; the first successful write creates the device.

Writes accept ``Idempotency-Key`` (durable receipts, scoped per device): a retried
request — e.g. replayed by the browser's offline outbox after a lost response —
returns the original response instead of applying twice. Updates and deletes are
conflict-checked with the rule's ``version``; a mismatch is ``409`` with
``code=version_conflict`` and the current rule (``null`` when it was deleted).
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import validate_ticker
from src.api.limiter import limiter
from src.core.config import settings
from src.core.device import DEVICE_KEY_HEADER, InvalidDeviceKeyError, device_key_hash, is_allowed_push_endpoint
from src.core.mutations import IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAY_HEADER, MutationError, validate_idempotency_key
from src.db.models import AlertDelivery, AlertRule, Company, Device, PushSubscription
from src.db.repositories.idempotency import IdempotencyRepository
from src.db.session import get_db
from src.schemas.alerts import (
    AlertDeliveryOut,
    AlertRuleCreate,
    AlertRuleFields,
    AlertRuleOut,
    AlertRuleUpdate,
    PushConfigOut,
    PushSubscriptionDelete,
    PushSubscriptionIn,
    PushSubscriptionOut,
    TestPushOut,
)
from src.services.alert_service import enqueue_delivery, text

DB = Annotated[AsyncSession, Depends(get_db)]
IdempotencyKey = Annotated[str | None, Header(alias=IDEMPOTENCY_KEY_HEADER)]

me_router = APIRouter(tags=["device"])

COMPANY_NOT_FOUND = "Hisse bulunamadı."
RULE_NOT_FOUND = "Alarm bulunamadı."
VERSION_CONFLICT = "Bu kayıt başka bir yerde değiştirildi."


def _device_hash(x_device_key: Annotated[str | None, Header(alias=DEVICE_KEY_HEADER)] = None) -> str:
    try:
        return device_key_hash(x_device_key)
    except InvalidDeviceKeyError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Geçerli bir cihaz anahtarı gerekli.") from exc


DeviceHash = Annotated[str, Depends(_device_hash)]


async def _find_device(db: AsyncSession, key_hash: str) -> Device | None:
    return (await db.execute(select(Device).where(Device.key_hash == key_hash))).scalar_one_or_none()


async def _ensure_device(db: AsyncSession, key_hash: str, locale: str | None = None) -> Device:
    """Get or create the device (race-safe: a concurrent insert of the same hash is absorbed)."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        await db.execute(
            pg_insert(Device).values(id=uuid.uuid4(), key_hash=key_hash, locale=locale or "tr").on_conflict_do_nothing(
                index_elements=["key_hash"]
            )
        )
    elif await _find_device(db, key_hash) is None:
        db.add(Device(key_hash=key_hash, locale=locale or "tr"))
        await db.flush()
    values: dict[str, Any] = {"last_seen_at": func.now()}
    if locale:
        values["locale"] = locale
    await db.execute(update(Device).where(Device.key_hash == key_hash).values(**values))
    device = await _find_device(db, key_hash)
    assert device is not None
    return device


async def _company(db: AsyncSession, ticker: str) -> Company:
    symbol = validate_ticker(ticker)
    company = (
        await db.execute(select(Company).where(Company.ticker == symbol, Company.is_active.is_(True)))
    ).scalar_one_or_none()
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=COMPANY_NOT_FOUND)
    return company


Operation = Callable[[], Awaitable[tuple[int, Any]]]


async def run_idempotent(
    db: AsyncSession, key_hash: str, action: str, raw_key: str | None, payload: Any, operation: Operation
) -> Response:
    """Execute ``operation`` once per (device, Idempotency-Key); 2xx responses are replayable.

    The receipt is committed in the same transaction as the write. Non-2xx outcomes
    (conflicts, validation) roll back, so the client may retry with the same key.
    """
    try:
        key = validate_idempotency_key(raw_key)
    except MutationError as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code})
    receipts = IdempotencyRepository(db)
    scope = f"device:{key_hash[:24]}:{action}"
    if key is not None:
        try:
            replay = await receipts.claim(scope, key, payload)
        except MutationError as exc:
            await db.rollback()
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code})
        if replay is not None:
            return _response(int(replay["status"]), replay.get("body"), replayed=True)
    try:
        code, body = await operation()
    except BaseException:
        await db.rollback()
        raise
    if not 200 <= code < 300:
        await db.rollback()
        return _response(code, body)
    if key is not None:
        await receipts.complete(scope, key, {"status": code, "body": body})
    await db.commit()
    return _response(code, body)


def _response(code: int, body: Any, *, replayed: bool = False) -> Response:
    headers = {IDEMPOTENT_REPLAY_HEADER: "true"} if replayed else None
    if code == status.HTTP_204_NO_CONTENT:
        return Response(status_code=code, headers=headers)
    return JSONResponse(status_code=code, content=body, headers=headers)


def _conflict(current: dict[str, Any] | None) -> tuple[int, dict[str, Any]]:
    return status.HTTP_409_CONFLICT, {"detail": VERSION_CONFLICT, "code": "version_conflict", "current": current}


# --- Rule serialization ----------------------------------------------------------------

def rule_state(rule: AlertRule) -> str:
    if not rule.enabled:
        return "disabled"
    if rule.kind == "kap" or rule.kind == "change_pct":
        return "active"
    if rule.armed is None:
        return "pending"
    if rule.armed:
        return "armed"
    if rule.trigger_count == 0:
        return "waiting_reset"
    return "done" if rule.repeat == "once" else "cooldown"


def rule_out(rule: AlertRule, company: Company) -> dict[str, Any]:
    return AlertRuleOut(
        id=rule.id,
        ticker=company.ticker,
        company_name=company.display_name,
        kind=rule.kind,  # type: ignore[arg-type]
        threshold=float(rule.threshold) if rule.threshold is not None else None,
        direction=rule.direction,  # type: ignore[arg-type]
        repeat=rule.repeat,  # type: ignore[arg-type]
        hysteresis_pct=float(rule.hysteresis_pct),
        min_severity=rule.min_severity,  # type: ignore[arg-type]
        enabled=rule.enabled,
        state=rule_state(rule),  # type: ignore[arg-type]
        trigger_count=rule.trigger_count,
        last_triggered_at=rule.last_triggered_at,
        version=rule.version,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    ).model_dump(mode="json")


async def _rule_with_company(db: AsyncSession, device_id: uuid.UUID, rule_id: uuid.UUID) -> tuple[AlertRule, Company] | None:
    row = (
        await db.execute(
            select(AlertRule, Company)
            .join(Company, Company.id == AlertRule.company_id)
            .where(AlertRule.id == rule_id, AlertRule.device_id == device_id)
        )
    ).first()
    return (row[0], row[1]) if row else None


def _apply_fields(rule: AlertRule, body: AlertRuleFields, company: Company) -> None:
    rule.company_id = company.id
    rule.kind = body.kind
    rule.threshold = body.threshold
    rule.direction = body.direction
    rule.repeat = body.repeat
    rule.hysteresis_pct = body.hysteresis_pct
    rule.min_severity = body.min_severity
    rule.enabled = body.enabled
    # A changed rule starts over: the next evaluation decides which side the price is on.
    rule.armed = None
    rule.trigger_count = 0


# --- Push ------------------------------------------------------------------------------

@me_router.get("/push/config", response_model=PushConfigOut)
async def push_config() -> PushConfigOut:
    """Whether Web Push is configured, and the VAPID public key for ``pushManager.subscribe``."""
    if not settings.push_enabled:
        return PushConfigOut(enabled=False)
    return PushConfigOut(enabled=True, vapid_public_key=settings.vapid_public_key.strip())


def _require_push() -> None:
    if not settings.push_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Bildirimler bu sunucuda yapılandırılmamış.")


@me_router.put("/me/push/subscription", response_model=PushSubscriptionOut)
@limiter.limit(lambda: settings.rate_limit_device_write)
async def put_subscription(request: Request, body: PushSubscriptionIn, db: DB, key_hash: DeviceHash) -> PushSubscriptionOut:
    """Register (or move to this device) a browser push subscription."""
    _require_push()
    if not is_allowed_push_endpoint(body.endpoint):
        raise HTTPException(status_code=422, detail="Desteklenmeyen bildirim servisi adresi.")
    device = await _ensure_device(db, key_hash, body.locale)
    existing = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    ).scalar_one_or_none()
    if existing is None:
        count = (
            await db.execute(select(func.count()).select_from(PushSubscription).where(PushSubscription.device_id == device.id))
        ).scalar_one()
        if count >= settings.alerts_max_subscriptions_per_device:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu cihaz için en fazla abonelik sayısına ulaşıldı.")
        existing = PushSubscription(device_id=device.id, endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth)
        db.add(existing)
    else:
        # The endpoint is the browser's; whoever registers it last owns it (restored backups).
        existing.device_id = device.id
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
        existing.failure_count = 0
    await db.flush()
    total = (
        await db.execute(select(func.count()).select_from(PushSubscription).where(PushSubscription.device_id == device.id))
    ).scalar_one()
    await db.commit()
    return PushSubscriptionOut(id=existing.id, subscriptions=total)


@me_router.delete("/me/push/subscription", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(lambda: settings.rate_limit_device_write)
async def delete_subscription(request: Request, body: PushSubscriptionDelete, db: DB, key_hash: DeviceHash) -> Response:
    device = await _find_device(db, key_hash)
    if device is not None:
        await db.execute(
            delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.device_id == device.id)
        )
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@me_router.post("/me/push/test", status_code=status.HTTP_202_ACCEPTED, response_model=TestPushOut)
@limiter.limit(lambda: settings.rate_limit_push_test)
async def send_test_push(request: Request, db: DB, key_hash: DeviceHash, background_tasks: BackgroundTasks) -> TestPushOut:
    """Queue a test notification to every subscription of this device (sent right away)."""
    _require_push()
    device = await _find_device(db, key_hash)
    subscriptions = 0
    if device is not None:
        subscriptions = (
            await db.execute(select(func.count()).select_from(PushSubscription).where(PushSubscription.device_id == device.id))
        ).scalar_one()
    if device is None or subscriptions == 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu cihazda kayıtlı bildirim aboneliği yok.")
    delivery_id = await enqueue_delivery(
        db,
        device_id=device.id,
        rule_id=None,
        dedup_key=f"test:{uuid.uuid4()}",
        kind="test",
        ticker=None,
        title=text(device.locale, "test_title"),
        body=text(device.locale, "test_body"),
        url="/alarmlar",
        ttl_seconds=300,
    )
    await db.commit()
    assert delivery_id is not None
    from src.workers.push_worker import process_push_once

    background_tasks.add_task(process_push_once)
    return TestPushOut(delivery_id=delivery_id, subscriptions=subscriptions)


# --- Alert rules -----------------------------------------------------------------------

@me_router.get("/me/alerts", response_model=list[AlertRuleOut])
async def list_alerts(db: DB, key_hash: DeviceHash, ticker: str | None = None) -> list[dict[str, Any]]:
    device = await _find_device(db, key_hash)
    if device is None:
        return []
    query = (
        select(AlertRule, Company)
        .join(Company, Company.id == AlertRule.company_id)
        .where(AlertRule.device_id == device.id)
        .order_by(AlertRule.created_at)
    )
    if ticker:
        query = query.where(Company.ticker == validate_ticker(ticker))
    return [rule_out(rule, company) for rule, company in (await db.execute(query)).all()]


@me_router.post("/me/alerts", status_code=status.HTTP_201_CREATED, response_model=AlertRuleOut)
@limiter.limit(lambda: settings.rate_limit_device_write)
async def create_alert(
    request: Request, body: AlertRuleCreate, db: DB, key_hash: DeviceHash, idempotency_key: IdempotencyKey = None
) -> Response:
    async def operation() -> tuple[int, Any]:
        company = await _company(db, body.ticker)
        device = await _ensure_device(db, key_hash)
        if body.id is not None:
            found = await _rule_with_company(db, device.id, body.id)
            if found is not None:  # created earlier (lost response, receipt expired): same result
                return status.HTTP_201_CREATED, rule_out(*found)
            other = (await db.execute(select(AlertRule.id).where(AlertRule.id == body.id))).scalar_one_or_none()
            if other is not None:
                return status.HTTP_409_CONFLICT, {"detail": "Bu alarm kimliği kullanılıyor.", "code": "id_taken"}
        count = (
            await db.execute(select(func.count()).select_from(AlertRule).where(AlertRule.device_id == device.id))
        ).scalar_one()
        if count >= settings.alerts_max_rules_per_device:
            return status.HTTP_409_CONFLICT, {
                "detail": f"En fazla {settings.alerts_max_rules_per_device} alarm kurulabilir.",
                "code": "limit_reached",
            }
        rule = AlertRule(id=body.id or uuid.uuid4(), device_id=device.id, version=1)
        _apply_fields(rule, body, company)
        db.add(rule)
        await db.flush()
        await db.refresh(rule)
        return status.HTTP_201_CREATED, rule_out(rule, company)

    return await run_idempotent(db, key_hash, "alerts:create", idempotency_key, body.model_dump(mode="json"), operation)


@me_router.put("/me/alerts/{rule_id}", response_model=AlertRuleOut)
@limiter.limit(lambda: settings.rate_limit_device_write)
async def update_alert(
    request: Request,
    rule_id: uuid.UUID,
    body: AlertRuleUpdate,
    db: DB,
    key_hash: DeviceHash,
    idempotency_key: IdempotencyKey = None,
) -> Response:
    async def operation() -> tuple[int, Any]:
        device = await _find_device(db, key_hash)
        found = await _rule_with_company(db, device.id, rule_id) if device else None
        if found is None:
            return _conflict(None)
        rule, current_company = found
        if rule.version != body.version:
            return _conflict(rule_out(rule, current_company))
        company = await _company(db, body.ticker)
        _apply_fields(rule, body, company)
        rule.version = rule.version + 1
        await db.flush()
        await db.refresh(rule)
        return status.HTTP_200_OK, rule_out(rule, company)

    payload = {"id": str(rule_id), **body.model_dump(mode="json")}
    return await run_idempotent(db, key_hash, "alerts:update", idempotency_key, payload, operation)


@me_router.delete("/me/alerts/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(lambda: settings.rate_limit_device_write)
async def delete_alert(
    request: Request,
    rule_id: uuid.UUID,
    db: DB,
    key_hash: DeviceHash,
    version: Annotated[int | None, Query(ge=1)] = None,
    idempotency_key: IdempotencyKey = None,
) -> Response:
    """Delete a rule; with ``version`` only if it was not changed meanwhile. Deleting a missing rule is a no-op."""

    async def operation() -> tuple[int, Any]:
        device = await _find_device(db, key_hash)
        found = await _rule_with_company(db, device.id, rule_id) if device else None
        if found is None:
            return status.HTTP_204_NO_CONTENT, None
        rule, company = found
        if version is not None and rule.version != version:
            return _conflict(rule_out(rule, company))
        await db.delete(rule)
        await db.flush()
        return status.HTTP_204_NO_CONTENT, None

    payload = {"id": str(rule_id), "version": version}
    return await run_idempotent(db, key_hash, "alerts:delete", idempotency_key, payload, operation)


@me_router.get("/me/alerts/deliveries", response_model=list[AlertDeliveryOut])
async def list_deliveries(
    db: DB, key_hash: DeviceHash, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[AlertDeliveryOut]:
    device = await _find_device(db, key_hash)
    if device is None:
        return []
    rows = (
        await db.execute(
            select(AlertDelivery)
            .where(AlertDelivery.device_id == device.id)
            .order_by(AlertDelivery.created_at.desc())
            .limit(limit)
        )
    ).scalars()
    return [
        AlertDeliveryOut(
            id=d.id,
            rule_id=d.rule_id,
            kind=d.kind,
            ticker=d.ticker,
            title=d.title,
            body=d.body,
            url=d.url,
            status=d.status,
            sent_count=d.sent_count,
            created_at=d.created_at,
            sent_at=d.sent_at,
        )
        for d in rows
    ]


@me_router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(lambda: settings.rate_limit_device_write)
async def forget_device(request: Request, db: DB, key_hash: DeviceHash) -> Response:
    """Erase everything stored for this device key (rules, subscriptions, deliveries, notes)."""
    await db.execute(delete(Device).where(Device.key_hash == key_hash))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
