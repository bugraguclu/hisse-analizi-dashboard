"""Seed script: companies (BIST 100), sources, polling_state, notification_rules.

BIST 100 uyeleri borsapy uzerinden canli cekilir (Index("XU100").components);
erisim yoksa asagidaki statik BIST 30 listesine geri duser.

Idempotent: every row is upserted by its natural key (ticker / source code /
source_id), so running the script again refreshes names and company data but keeps
operator-tuned source settings (poll_interval_seconds is only set on insert). The demo notification
rule (test@example.com) is created only outside production/staging and only when no
rule exists yet.
"""
import asyncio
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.config import settings  # noqa: E402
from src.core.enums import NotificationChannel, NotificationFrequency, Severity, SourceKind  # noqa: E402
from src.db.repository import (  # noqa: E402
    CompanyRepository,
    NotificationRuleRepository,
    PollingStateRepository,
    SourceRepository,
)
from src.db.session import async_session_factory, dispose_engine  # noqa: E402


# Statik yedek liste: BIST 30 (Mart 2026) — borsapy erisilemezse kullanilir
FALLBACK_COMPANIES = [
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

SOURCES_DATA: list[dict[str, Any]] = [
    {
        "code": "kap",
        "name": "KAP Bildirimleri",
        "base_url": "https://www.kap.org.tr",
        "kind": SourceKind.KAP,
        "poll_interval_seconds": 300,
    },
    {
        "code": "price",
        "name": "Fiyat Verisi",
        "base_url": None,
        "kind": SourceKind.PRICE_DATA,
        "poll_interval_seconds": 300,
    },
    {
        "code": "financials",
        "name": "Finansal Tablolar",
        "base_url": None,
        "kind": SourceKind.FINANCIAL_STATEMENTS,
        "poll_interval_seconds": 3600,
    },
]


def fetch_bist100_companies() -> list[dict[str, Any]]:
    """BIST 100 uyelerini borsapy'den cek; hata durumunda statik listeye don."""
    try:
        import borsapy as bp

        components = bp.Index("XU100").components
        fallback_by_ticker = {c["ticker"]: c for c in FALLBACK_COMPANIES}
        companies = []
        for comp in components:
            ticker = comp["symbol"]
            name = comp.get("name") or ticker
            known = fallback_by_ticker.get(ticker, {})
            companies.append({
                "ticker": ticker,
                "legal_name": known.get("legal_name", name.title()),
                "display_name": known.get("display_name", name.title()),
                "sector": known.get("sector"),
            })
        if len(companies) >= 50:
            print(f"BIST 100 listesi borsapy'den alindi: {len(companies)} sirket")
            return companies
        print(f"borsapy beklenenden az sirket dondurdu ({len(companies)}), statik listeye donuluyor")
    except Exception as e:
        print(f"borsapy BIST 100 listesi alinamadi ({e}), statik listeye donuluyor")
    return FALLBACK_COMPANIES


async def apply_official_names(company_list: list[dict[str, Any]]) -> None:
    """Official KAP titles as legal names; Turkish letters restored in feed short names.

    Curated entries (FALLBACK_COMPANIES) are left untouched. If KAP is unreachable the
    market-data names are kept.
    """
    from src.adapters.fundamentals import get_kap_company_titles
    from src.parsers.helpers import restore_turkish_name

    try:
        titles = await get_kap_company_titles()
    except Exception as e:
        print(f"KAP sirket unvanlari alinamadi ({e}); borsapy adlari kullaniliyor")
        return
    curated = {c["ticker"] for c in FALLBACK_COMPANIES}
    updated = 0
    for company in company_list:
        title = titles.get(company["ticker"])
        if not title or company["ticker"] in curated:
            continue
        company["legal_name"] = title
        company["display_name"] = restore_turkish_name(company["display_name"], title)
        updated += 1
    print(f"KAP resmi unvanlari uygulandi: {updated} sirket")


async def seed() -> None:
    company_list = fetch_bist100_companies()
    await apply_official_names(company_list)
    try:
        async with async_session_factory() as session:
            company_repo = CompanyRepository(session)
            source_repo = SourceRepository(session)
            polling_repo = PollingStateRepository(session)

            # --- Şirketler ---
            companies = []
            for c_data in company_list:
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
                source = await source_repo.upsert(**s_data, keep_existing=("poll_interval_seconds",))
                await polling_repo.upsert(source.id)

            # --- Bildirim kuralı (yalnızca geliştirme/test için demo) ---
            rule_repo = NotificationRuleRepository(session)
            existing_rules = await rule_repo.get_all()
            created_demo_rule = False
            if not existing_rules and companies and not settings.is_production:
                await rule_repo.create(
                    company_id=companies[0].id,
                    email="test@example.com",
                    channel=NotificationChannel.EMAIL,
                    frequency=NotificationFrequency.INSTANT,
                    min_severity=Severity.INFO,
                    source_filters=[],
                    enabled=True,
                )
                created_demo_rule = True

            await session.commit()

            print("Seed completed successfully!")
            print(f"  Companies: {len(companies)}")
            for c in companies:
                print(f"    - {c.ticker}: {c.display_name}")
            print(f"  Sources: {len(SOURCES_DATA)}")
            print(f"  Notification rules: {len(existing_rules) + int(created_demo_rule)}")
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(seed())
