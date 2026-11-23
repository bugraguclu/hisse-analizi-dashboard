"""iOS Widget pairing, device management, and read-only summary API endpoints."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, timedelta
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.limiter import limiter
from src.core.time import utcnow
from src.db.models import WidgetDevice
from src.db.repositories.widget import WidgetRepository
from src.db.session import get_db
from src.schemas.widget import (
    WidgetDeviceOut,
    WidgetDevicesListOut,
    WidgetDeviceUpdateIn,
    WidgetPairingCreateIn,
    WidgetPairingOut,
    WidgetPairOut,
    WidgetPairRequestIn,
    WidgetSummaryOut,
)
from src.services.widget_service import (
    CODE_LENGTH,
    PAIRING_MINUTES,
    build_widget_summary,
    digest,
    generate_device_token,
    generate_pairing_code,
    normalize_pairing_code,
    sanitize_device_name,
    sanitize_label,
    sanitize_watchlist_tickers,
)

logger = structlog.get_logger(__name__)

widget_router = APIRouter(prefix="/widget", tags=["widget"])
DB = Annotated[AsyncSession, Depends(get_db)]

_OWNER_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_PAIR_RATE_LIMIT = "20/minute"
_CODE_RATE_LIMIT = "20/minute"
_TOUCH_INTERVAL = timedelta(minutes=5)

_INVALID_CODE_DETAIL = "Kod geçersiz ya da süresi dolmuş. Web uygulamasından yeni kod oluştur."
_UNPAIRED_DETAIL = "Widget bağlantısı kaldırılmış. iPhone'da yeniden bağlan."
_OWNER_REQUIRED_DETAIL = "Cihaz yönetimi için geçerli X-Widget-Owner başlığı gerekli."


def require_widget_owner(
    x_widget_owner: Annotated[str | None, Header(alias="X-Widget-Owner")] = None,
) -> str:
    """Validate the workspace owner key header and return its SHA-256 hash."""
    raw = (x_widget_owner or "").strip()
    if not _OWNER_KEY_RE.match(raw):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_OWNER_REQUIRED_DETAIL,
        )
    return digest(raw)


OwnerHash = Annotated[str, Depends(require_widget_owner)]


def _bearer_token(authorization: str | None) -> str:
    """Return the bearer credential; the auth scheme is case-insensitive (RFC 7235)."""
    scheme, _, credentials = (authorization or "").strip().partition(" ")
    return credentials.strip() if scheme.lower() == "bearer" else ""


async def _paired_device(repo: WidgetRepository, authorization: str | None) -> WidgetDevice | None:
    token = _bearer_token(authorization)
    return await repo.get_device_by_token_hash(digest(token)) if token else None


def _unpaired_response() -> JSONResponse:
    return JSONResponse(
        {"detail": _UNPAIRED_DETAIL, "code": "widget_unpaired"},
        status_code=status.HTTP_401_UNAUTHORIZED,
        headers={"WWW-Authenticate": "Bearer"},
    )


@widget_router.get("/devices", response_model=WidgetDevicesListOut)
async def list_widget_devices(db: DB, owner_hash: OwnerHash) -> WidgetDevicesListOut:
    """List iPhone widgets paired to this web workspace."""
    devices = await WidgetRepository(db).list_devices(owner_hash)
    return WidgetDevicesListOut(devices=[WidgetDeviceOut.model_validate(d) for d in devices])


@widget_router.post("/devices", response_model=WidgetPairingOut, status_code=status.HTTP_201_CREATED)
@limiter.limit(_CODE_RATE_LIMIT)
async def create_widget_pairing_code(
    request: Request,
    body: WidgetPairingCreateIn,
    db: DB,
    owner_hash: OwnerHash,
) -> WidgetPairingOut:
    """Create a 10-minute single-use pairing code bound to the selected watchlist."""
    now = utcnow()
    expires_at = now + timedelta(minutes=PAIRING_MINUTES)
    code = generate_pairing_code()
    watchlist_id = sanitize_label(body.watchlist_id, 80) or "favorites"
    watchlist_name = sanitize_label(body.watchlist_name, 80)
    tickers = sanitize_watchlist_tickers(body.tickers)
    dashboard_id = sanitize_label(body.dashboard_id, 80) or None

    await WidgetRepository(db).replace_pairing(
        owner_hash=owner_hash,
        code_hash=digest(code),
        watchlist_id=watchlist_id,
        watchlist_name=watchlist_name,
        tickers=tickers,
        dashboard_id=dashboard_id,
        now=now,
        expires_at=expires_at,
    )
    await db.commit()
    logger.info("widget_pairing_code_created", watchlist_id=watchlist_id, ticker_count=len(tickers))
    return WidgetPairingOut(
        code=code,
        expires_at=expires_at,
        watchlist_id=watchlist_id,
        watchlist_name=watchlist_name,
        tickers=tickers,
    )


@widget_router.patch("/devices/{device_id}", response_model=WidgetDeviceOut)
async def update_widget_device(
    device_id: uuid.UUID,
    body: WidgetDeviceUpdateIn,
    db: DB,
    owner_hash: OwnerHash,
) -> WidgetDeviceOut:
    """Update the watchlist/tickers shown on an already-paired iOS device."""
    watchlist_id = sanitize_label(body.watchlist_id, 80) or "favorites"
    watchlist_name = sanitize_label(body.watchlist_name, 80)
    tickers = sanitize_watchlist_tickers(body.tickers)
    dashboard_id = sanitize_label(body.dashboard_id, 80) or None

    device = await WidgetRepository(db).update_device(
        owner_hash=owner_hash,
        device_id=device_id,
        watchlist_id=watchlist_id,
        watchlist_name=watchlist_name,
        tickers=tickers,
        dashboard_id=dashboard_id,
    )
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bağlı cihaz bulunamadı.")
    await db.commit()
    return WidgetDeviceOut.model_validate(device)


@widget_router.delete("/devices/{device_id}")
async def revoke_widget_device(
    device_id: uuid.UUID,
    db: DB,
    owner_hash: OwnerHash,
) -> dict[str, bool]:
    """Revoke a paired iPhone's access immediately."""
    deleted = await WidgetRepository(db).delete_device(owner_hash=owner_hash, device_id=device_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bağlı cihaz bulunamadı.")
    await db.commit()
    logger.info("widget_device_revoked", device_id=str(device_id), by="web")
    return {"revoked": True}


@widget_router.post(
    "/pair",
    response_model=WidgetPairOut,
    responses={400: {"description": "Kod geçersiz ya da süresi dolmuş (code: invalid_code)"}},
)
@limiter.limit(_PAIR_RATE_LIMIT)
async def pair_widget_device(
    request: Request,
    body: WidgetPairRequestIn,
    db: DB,
):
    """Consume a single-use pairing code and issue a read-only bearer token for the iOS widget."""
    normalized = normalize_pairing_code(body.code)
    if len(normalized) != CODE_LENGTH:
        return JSONResponse(
            {"detail": _INVALID_CODE_DETAIL, "code": "invalid_code"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    device_name = sanitize_device_name(body.name)
    token = generate_device_token()
    device = await WidgetRepository(db).consume_pairing(
        code_hash=digest(normalized),
        now=utcnow(),
        device_name=device_name,
        token_hash=digest(token),
    )
    if device is None:
        return JSONResponse(
            {"detail": _INVALID_CODE_DETAIL, "code": "invalid_code"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    await db.commit()
    logger.info("widget_device_paired", device_id=str(device.id), device_name=device.name)
    return WidgetPairOut(
        token=token,
        scope=device.scope,
        device=WidgetDeviceOut.model_validate(device),
    )


@widget_router.get(
    "/summary",
    response_model=WidgetSummaryOut,
    responses={401: {"description": "Widget bağlantısı kaldırılmış (code: widget_unpaired)"}},
)
async def widget_summary(
    db: DB,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
):
    """Read-only BIST 100, paired watchlist quotes, and upcoming financial events for iOS widgets."""
    repo = WidgetRepository(db)
    device = await _paired_device(repo, authorization)
    if device is None:
        return _unpaired_response()

    now = utcnow()
    # Widgets refresh often; record "last seen" at most every few minutes instead of
    # writing to the database on every request.
    last_seen = device.last_seen_at
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=UTC)
    if last_seen is None or now - last_seen >= _TOUCH_INTERVAL:
        await repo.touch_device(device.id, now)
        await db.commit()
    return await build_widget_summary(db, device)


@widget_router.delete(
    "/summary",
    responses={401: {"description": "Widget bağlantısı kaldırılmış (code: widget_unpaired)"}},
)
async def unpair_from_phone(
    db: DB,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
):
    """Allow a paired iPhone to revoke its own read-only token."""
    repo = WidgetRepository(db)
    device = await _paired_device(repo, authorization)
    if device is None:
        return _unpaired_response()
    await repo.delete_device_by_id(device.id)
    await db.commit()
    logger.info("widget_device_revoked", device_id=str(device.id), by="phone")
    return {"revoked": True}
