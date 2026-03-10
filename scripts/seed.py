"""Seed script: companies, sources, polling_state, notification_rules."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.enums import SourceKind, Severity, NotificationChannel, NotificationFrequency
from src.db.session import async_session_factory
from src.db.repository import (
    CompanyRepository,
    SourceRepository,
    PollingStateRepository,
    NotificationRuleRepository,
)


async def seed():
    async with async_session_factory() as session:
        # Company
        company_repo = CompanyRepository(session)
        company = await company_repo.upsert(
            ticker="AEFES",
            legal_name="ANADOLU EFES BİRACILIK VE MALT SANAYİİ A.Ş.",
            display_name="Anadolu Efes",
            isin=None,
            exchange="BIST",
            aliases=["AEFES", "Anadolu Efes"],
            is_active=True,
        )

        # Sources
        source_repo = SourceRepository(session)
        sources_data = [
            {
                "code": "kap",
                "name": "KAP Bildirimleri",
                "base_url": "https://www.kap.org.tr",
                "kind": SourceKind.KAP,
                "poll_interval_seconds": 30,
            },
            {
                "code": "anadoluefes_news",
                "name": "Anadolu Efes Kurumsal Haberler",
                "base_url": "https://www.anadoluefes.com",
                "kind": SourceKind.OFFICIAL_NEWS,
                "poll_interval_seconds": 60,
            },
            {
                "code": "anadoluefes_ir",
                "name": "Anadolu Efes Yatırımcı İlişkileri",
                "base_url": "https://www.anadoluefes.com/sayfa/1/652/yatirimci-iliskileri",
                "kind": SourceKind.OFFICIAL_IR,
                "poll_interval_seconds": 300,
            },
            {
                "code": "price",
                "name": "Fiyat Verisi (borsapy / yfinance)",
                "base_url": None,
                "kind": SourceKind.PRICE_DATA,
                "poll_interval_seconds": 300,
            },
        ]

        polling_repo = PollingStateRepository(session)
        for s_data in sources_data:
            source = await source_repo.upsert(**s_data)
            await polling_repo.upsert(source.id)

        # Notification rule
        rule_repo = NotificationRuleRepository(session)
        existing_rules = await rule_repo.get_all()
        if not existing_rules:
            await rule_repo.create(
                company_id=company.id,
                email="test@example.com",
                channel=NotificationChannel.EMAIL,
                frequency=NotificationFrequency.INSTANT,
                min_severity=Severity.INFO,
                source_filters=[],
                enabled=True,
            )

        await session.commit()
        print("Seed completed successfully!")
        print(f"  Company: {company.ticker} ({company.display_name})")
        print(f"  Sources: {len(sources_data)}")
        print(f"  Notification rules: {len(existing_rules) or 1}")


if __name__ == "__main__":
    asyncio.run(seed())
