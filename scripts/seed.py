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
    bist30_tickers = [
        "AEFES", "AKBNK", "AKSA", "ALARK", "ARCLK", "ASELS", "ASTOR", "BIMAS",
        "EKGYO", "ENKAI", "EREGL", "FROTO", "GARAN", "GUBRF", "HALKB", "HETSH",
        "ISCTR", "KCHOL", "KONTR", "KOZAL", "KRDMD", "ODAS", "OYAKC", "PETKM",
        "PGSUS", "SAHOL", "SASA", "SISE", "TAVHL", "TCELL", "THYAO", "TKFEN",
        "TOASO", "TUPRS", "VAKBN", "YKBNK"
    ]

    async with async_session_factory() as session:
        # Repositories
        company_repo = CompanyRepository(session)
        source_repo = SourceRepository(session)
        polling_repo = PollingStateRepository(session)
        rule_repo = NotificationRuleRepository(session)

        # Global Sources (Generic for all companies)
        sources_data = [
            {
                "code": "kap",
                "name": "KAP Bildirimleri",
                "base_url": "https://www.kap.org.tr",
                "kind": SourceKind.KAP,
                "poll_interval_seconds": 30,
            },
            {
                "code": "price",
                "name": "Fiyat Verisi (borsapy / yfinance)",
                "base_url": None,
                "kind": SourceKind.PRICE_DATA,
                "poll_interval_seconds": 300,
            },
            {
                "code": "financials",
                "name": "Finansal Tablolar (borsapy)",
                "base_url": None,
                "kind": SourceKind.FINANCIAL_STATEMENTS,
                "poll_interval_seconds": 3600,
            },
        ]

        # Upsert global sources and their polling states
        source_id_map = {}
        for s_data in sources_data:
            source = await source_repo.upsert(**s_data)
            source_id_map[s_data["code"]] = source.id
            await polling_repo.upsert(source.id)

        # Process each BIST 30 company
        for ticker in bist30_tickers:
            # For now using ticker as legal_name/display_name placeholder if not AEFES
            # In a real scenario, we'd fetch this from bp.companies()
            display_name = "Anadolu Efes" if ticker == "AEFES" else ticker
            legal_name = "ANADOLU EFES BİRACILIK VE MALT SANAYİİ A.Ş." if ticker == "AEFES" else f"{ticker} ANONİM ŞİRKETİ"

            company = await company_repo.upsert(
                ticker=ticker,
                legal_name=legal_name,
                display_name=display_name,
                isin=None,
                exchange="BIST",
                aliases=[ticker],
                is_active=True,
            )

            # Company specific sources (Optional for now, keeping AEFES ones as example)
            if ticker == "AEFES":
                aefes_sources = [
                    {
                        "code": "official_news",
                        "name": "Anadolu Efes Kurumsal Haberler",
                        "base_url": "https://www.anadoluefes.com",
                        "kind": SourceKind.OFFICIAL_NEWS,
                        "poll_interval_seconds": 60,
                    },
                    {
                        "code": "official_ir",
                        "name": "Anadolu Efes Yatırımcı İlişkileri",
                        "base_url": "https://www.anadoluefes.com/sayfa/1/652/yatirimci-iliskileri",
                        "kind": SourceKind.OFFICIAL_IR,
                        "poll_interval_seconds": 300,
                    }
                ]
                for s_data in aefes_sources:
                    source = await source_repo.upsert(**s_data)
                    await polling_repo.upsert(source.id)

        # Notification rule for the company
            existing_rules = await rule_repo.get_all()
            company_rules = [r for r in existing_rules if r.company_id == company.id]
            
            if not company_rules:
                await rule_repo.create(
                    company_id=company.id,
                    email="assistant-test@example.com",
                    channel=NotificationChannel.EMAIL,
                    frequency=NotificationFrequency.INSTANT,
                    min_severity=Severity.INFO,
                    source_filters=[],
                    enabled=True,
                )

        await session.commit()
        print(f"Seed completed successfully for {len(bist30_tickers)} companies!")


if __name__ == "__main__":
    asyncio.run(seed())
