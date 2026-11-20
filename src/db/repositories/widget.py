"""Repository for iOS widget pairing codes, paired devices, and upcoming company events."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, datetime

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Company, Dividend, ExpectedDisclosure, WidgetDevice, WidgetPairing


class WidgetRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def replace_pairing(
        self,
        *,
        owner_hash: str,
        code_hash: str,
        watchlist_id: str,
        watchlist_name: str,
        tickers: list[str],
        dashboard_id: str | None,
        now: datetime,
        expires_at: datetime,
    ) -> WidgetPairing:
        """Keep at most one active pairing code per workspace owner and purge expired codes."""
        await self.db.execute(
            delete(WidgetPairing).where(
                or_(WidgetPairing.owner_hash == owner_hash, WidgetPairing.expires_at <= now)
            )
        )
        pairing = WidgetPairing(
            owner_hash=owner_hash,
            code_hash=code_hash,
            watchlist_id=watchlist_id,
            watchlist_name=watchlist_name,
            tickers=list(tickers),
            dashboard_id=dashboard_id,
            expires_at=expires_at,
        )
        self.db.add(pairing)
        await self.db.flush()
        return pairing

    async def consume_pairing(
        self,
        *,
        code_hash: str,
        now: datetime,
        device_name: str,
        token_hash: str,
    ) -> WidgetDevice | None:
        """Atomically consume a valid pairing code and create the paired read-only device.

        Uses ``FOR UPDATE`` when supported by the dialect so two concurrent requests with the
        same code cannot both succeed.
        """
        stmt = select(WidgetPairing).where(
            WidgetPairing.code_hash == code_hash,
            WidgetPairing.expires_at > now,
        )
        bind = self.db.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            stmt = stmt.with_for_update()

        pairing = (await self.db.execute(stmt)).scalar_one_or_none()
        if pairing is None:
            return None

        device = WidgetDevice(
            owner_hash=pairing.owner_hash,
            name=device_name,
            token_hash=token_hash,
            scope="widget:read",
            watchlist_id=pairing.watchlist_id,
            watchlist_name=pairing.watchlist_name,
            tickers=list(pairing.tickers or []),
            dashboard_id=pairing.dashboard_id,
        )
        await self.db.delete(pairing)
        self.db.add(device)
        await self.db.flush()
        return device

    async def list_devices(self, owner_hash: str) -> list[WidgetDevice]:
        result = await self.db.execute(
            select(WidgetDevice)
            .where(WidgetDevice.owner_hash == owner_hash)
            .order_by(WidgetDevice.created_at.desc())
        )
        return list(result.scalars().all())

    async def update_device(
        self,
        *,
        owner_hash: str,
        device_id: uuid.UUID,
        watchlist_id: str,
        watchlist_name: str,
        tickers: list[str],
        dashboard_id: str | None,
    ) -> WidgetDevice | None:
        device = (
            await self.db.execute(
                select(WidgetDevice).where(
                    WidgetDevice.id == device_id,
                    WidgetDevice.owner_hash == owner_hash,
                )
            )
        ).scalar_one_or_none()
        if device is None:
            return None
        device.watchlist_id = watchlist_id
        device.watchlist_name = watchlist_name
        device.tickers = list(tickers)
        device.dashboard_id = dashboard_id
        await self.db.flush()
        return device

    async def delete_device(self, *, owner_hash: str, device_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            delete(WidgetDevice).where(
                WidgetDevice.id == device_id,
                WidgetDevice.owner_hash == owner_hash,
            )
        )
        return (result.rowcount or 0) > 0

    async def get_device_by_token_hash(self, token_hash: str) -> WidgetDevice | None:
        result = await self.db.execute(
            select(WidgetDevice).where(WidgetDevice.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def touch_device(self, device_id: uuid.UUID, seen_at: datetime) -> None:
        await self.db.execute(
            update(WidgetDevice).where(WidgetDevice.id == device_id).values(last_seen_at=seen_at)
        )

    async def delete_device_by_id(self, device_id: uuid.UUID) -> bool:
        result = await self.db.execute(delete(WidgetDevice).where(WidgetDevice.id == device_id))
        return (result.rowcount or 0) > 0

    async def company_names_for_tickers(self, tickers: Sequence[str]) -> dict[str, str]:
        if not tickers:
            return {}
        rows = (
            await self.db.execute(
                select(Company.ticker, Company.display_name).where(Company.ticker.in_(list(tickers)))
            )
        ).all()
        return {ticker: display_name for ticker, display_name in rows}

    async def upcoming_expected_disclosures(
        self,
        tickers: Sequence[str],
        *,
        from_date: date,
        until_date: date,
    ) -> list[tuple[str, ExpectedDisclosure]]:
        if not tickers:
            return []
        stmt = (
            select(Company.ticker, ExpectedDisclosure)
            .join(Company, Company.id == ExpectedDisclosure.company_id)
            .where(
                Company.ticker.in_(list(tickers)),
                or_(
                    ExpectedDisclosure.start_date.between(from_date, until_date),
                    ExpectedDisclosure.end_date.between(from_date, until_date),
                ),
            )
            .order_by(ExpectedDisclosure.start_date.asc().nulls_last(), ExpectedDisclosure.end_date.asc().nulls_last())
        )
        rows = (await self.db.execute(stmt)).all()
        return [(ticker, disclosure) for ticker, disclosure in rows]

    async def upcoming_dividends(
        self,
        tickers: Sequence[str],
        *,
        from_date: date,
        until_date: date,
    ) -> list[tuple[str, Dividend]]:
        if not tickers:
            return []
        stmt = (
            select(Company.ticker, Dividend)
            .join(Company, Company.id == Dividend.company_id)
            .where(
                Company.ticker.in_(list(tickers)),
                or_(
                    Dividend.ex_date.between(from_date, until_date),
                    Dividend.payment_date.between(from_date, until_date),
                ),
            )
            .order_by(Dividend.ex_date.asc())
        )
        rows = (await self.db.execute(stmt)).all()
        return [(ticker, dividend) for ticker, dividend in rows]
