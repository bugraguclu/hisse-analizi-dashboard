"""Seed script: companies (BIST 30), sources, polling_state, notification_rules."""
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


# BIST 30 şirketleri (Mart 2026 — güncelleme gerekebilir)
BIST30_COMPANIES = [
    {"ticker": "AEFES", "legal_name": "ANADOLU EFES BİRACILIK VE MALT SANAYİİ A.Ş.", "display_name": "Anadolu Efes", "sector": "Gıda & İçecek"},
    {"ticker": "AKBNK", "legal_name": "AKBANK T.A.Ş.", "display_name": "Akbank", "sector": "Bankacılık"},
    {"ticker": "ARCLK", "legal_name": "ARÇELİK A.Ş.", "display_name": "Arçelik", "sector": "Dayanıklı Tüketim"},
    {"ticker": "ASELS", "legal_name": "ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş.", "display_name": "Aselsan", "sector": "Savunma"},
    {"ticker": "BIMAS", "legal_name": "BİM BİRLEŞİK MAĞAZALAR A.Ş.", "display_name": "BİM", "sector": "Perakende"},
    {"ticker": "EKGYO", "legal_name": "EMLAK KONUT GAYRİMENKUL YATIRIM ORTAKLIĞI A.Ş.", "display_name": "Emlak Konut GYO", "sector": "GYO"},
    {"ticker": "ENKAI", "legal_name": "ENKA İNŞAAT VE SANAYİ A.Ş.", "display_name": "Enka İnşaat", "sector": "İnşaat"},
    {"ticker": "EREGL", "legal_name": "EREĞLİ DEMİR VE ÇELİK FABRİKALARI T.A.Ş.", "display_name": "Ereğli Demir Çelik", "sector": "Metal & Çelik"},
    {"ticker": "FROTO", "legal_name": "FORD OTOSAN OTOMOBİL SANAYİ A.Ş.", "display_name": "Ford Otosan", "sector": "Otomotiv"},
    {"ticker": "GARAN", "legal_name": "TÜRKİYE GARANTİ BANKASI A.Ş.", "display_name": "Garanti BBVA", "sector": "Bankacılık"},
    {"ticker": "GUBRF", "legal_name": "GÜBRE FABRİKALARI T.A.Ş.", "display_name": "Gübre Fabrikaları", "sector": "Kimya"},
    {"ticker": "HEKTS", "legal_name": "HEKTAŞ TİCARET T.A.Ş.", "display_name": "Hektaş", "sector": "Tarım & Kimya"},
    {"ticker": "ISCTR", "legal_name": "TÜRKİYE İŞ BANKASI A.Ş.", "display_name": "İş Bankası", "sector": "Bankacılık"},
    {"ticker": "KCHOL", "legal_name": "KOÇ HOLDİNG A.Ş.", "display_name": "Koç Holding", "sector": "Holding"},
    {"ticker": "KOZAL", "legal_name": "KOZA ALTIN İŞLETMELERİ A.Ş.", "display_name": "Koza Altın", "sector": "Madencilik"},
    {"ticker": "KOZAA", "legal_name": "KOZA ANADOLU METAL MADENCİLİK İŞLETMELERİ A.Ş.", "display_name": "Koza Anadolu", "sector": "Madencilik"},
    {"ticker": "KRDMD", "legal_name": "KARDEMİR KARABÜK DEMİR ÇELİK SANAYİ VE TİCARET A.Ş.", "display_name": "Kardemir", "sector": "Metal & Çelik"},
    {"ticker": "PETKM", "legal_name": "PETKİM PETROKİMYA HOLDİNG A.Ş.", "display_name": "Petkim", "sector": "Petrokimya"},
    {"ticker": "PGSUS", "legal_name": "PEGASUS HAVA TAŞIMACILIĞI A.Ş.", "display_name": "Pegasus", "sector": "Havacılık"},
    {"ticker": "SAHOL", "legal_name": "HACI ÖMER SABANCI HOLDİNG A.Ş.", "display_name": "Sabancı Holding", "sector": "Holding"},
    {"ticker": "SASA", "legal_name": "SASA POLYESTER SANAYİ A.Ş.", "display_name": "SASA", "sector": "Kimya"},
    {"ticker": "SISE", "legal_name": "TÜRKİYE ŞİŞE VE CAM FABRİKALARI A.Ş.", "display_name": "Şişecam", "sector": "Cam"},
    {"ticker": "TAVHL", "legal_name": "TAV HAVALİMANLARI HOLDİNG A.Ş.", "display_name": "TAV Havalimanları", "sector": "Havacılık"},
    {"ticker": "TCELL", "legal_name": "TURKCELL İLETİŞİM HİZMETLERİ A.Ş.", "display_name": "Turkcell", "sector": "Telekomünikasyon"},
    {"ticker": "THYAO", "legal_name": "TÜRK HAVA YOLLARI A.O.", "display_name": "Türk Hava Yolları", "sector": "Havacılık"},
    {"ticker": "TKFEN", "legal_name": "TEKFEN HOLDİNG A.Ş.", "display_name": "Tekfen Holding", "sector": "Holding"},
    {"ticker": "TOASO", "legal_name": "TOFAŞ TÜRK OTOMOBİL FABRİKASI A.Ş.", "display_name": "Tofaş", "sector": "Otomotiv"},
    {"ticker": "TUPRS", "legal_name": "TÜPRAŞ-TÜRKİYE PETROL RAFİNERİLERİ A.Ş.", "display_name": "Tüpraş", "sector": "Enerji"},
    {"ticker": "VAKBN", "legal_name": "TÜRKİYE VAKIFLAR BANKASI T.A.O.", "display_name": "Vakıfbank", "sector": "Bankacılık"},
    {"ticker": "YKBNK", "legal_name": "YAPI VE KREDİ BANKASI A.Ş.", "display_name": "Yapı Kredi", "sector": "Bankacılık"},
]

SOURCES_DATA = [
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


async def seed():
    async with async_session_factory() as session:
        company_repo = CompanyRepository(session)
        source_repo = SourceRepository(session)
        polling_repo = PollingStateRepository(session)

        # --- Şirketler ---
        companies = []
        for c_data in BIST30_COMPANIES:
            company = await company_repo.upsert(
                ticker=c_data["ticker"],
                legal_name=c_data["legal_name"],
                display_name=c_data["display_name"],
                isin=None,
                exchange="BIST",
                aliases=[c_data["ticker"], c_data["display_name"]],
                is_active=True,
            )
            companies.append(company)

        # --- Kaynaklar ---
        for s_data in SOURCES_DATA:
            source = await source_repo.upsert(**s_data)
            await polling_repo.upsert(source.id)

        # --- Bildirim kuralı (opsiyonel, test için) ---
        rule_repo = NotificationRuleRepository(session)
        existing_rules = await rule_repo.get_all()
        if not existing_rules and companies:
            await rule_repo.create(
                company_id=companies[0].id,
                email="test@example.com",
                channel=NotificationChannel.EMAIL,
                frequency=NotificationFrequency.INSTANT,
                min_severity=Severity.INFO,
                source_filters=[],
                enabled=True,
            )

        await session.commit()

        print(f"Seed completed successfully!")
        print(f"  Companies: {len(companies)} (BIST 30)")
        for c in companies:
            print(f"    - {c.ticker}: {c.display_name}")
        print(f"  Sources: {len(SOURCES_DATA)}")
        print(f"  Notification rules: {len(existing_rules) or 1}")


if __name__ == "__main__":
    asyncio.run(seed())
