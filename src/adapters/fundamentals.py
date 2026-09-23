"""Temel analiz adaptörü — şirket bilgileri, finansal tablolar, oranlar, temettü, ortaklık yapısı.

Bu modül bir cephedir (facade): uygulama kodu ve testler buradan içe aktarır, gerçek
kod alanlara göre bölünmüştür:

- :mod:`src.adapters.fundamentals_common` — sabitler, hata yardımcıları, KAP şirket dizini
- :mod:`src.adapters.fundamentals_statements` — KAP/İş Yatırım tabloları, TTM oranları
- :mod:`src.adapters.fundamentals_snapshot` — canlı fiyat özeti (fast-info), şirket künyesi
- :mod:`src.adapters.fundamentals_reference` — temettü, analist, ortaklık, hedef fiyat, takvim, bildirimler

Kaynaklar:

- **KAP "Şirket Finansal Bilgileri" özeti** — resmi, ilk açıklandığı haliyle
  bilanço ve gelir tablosu (son 3 yıl sonu + en son ara dönem). Birincil kaynak.
- **İş Yatırım MaliTablo** — ara çeyrekler, nakit akışı, amortisman (FAVÖK),
  nakit ve finansal borç. IAS 29 uygulayan şirketlerde yıl sonu kolonlarını
  güncel satın alma gücüne göre yeniden ifade eder; KAP ile örtüşen dönemlerde
  katsayıyla ilk açıklanan değere çevrilir (bkz. ``restatement_factor``).
- **TradingView tarayıcısı** — canlı fiyat, piyasa değeri, 52 hafta, ortalamalar.
- **borsapy** — KAP künyesi, temettü/sermaye artırımı, ortaklık yapısı, analist
  hedefleri, KAP bildirimleri ve beklenen finansal rapor takvimi.

Her upstream sonucu TTL cache + single-flight (``cached``) ile paylaşılır; senkron
borsapy çağrıları thread havuzunda (``run_sync``) çalışır. Hata durumunda
fonksiyonlar kısa Türkçe ``error`` + ``error_status`` içeren sözlük döndürür
(ham exception metni asla dışarı sızmaz).
"""

from src.adapters.fundamentals_common import (  # noqa: F401
    ISTANBUL_TZ,
    KAP_BASE_URL,
    KAP_BIST_COMPANIES_URL,
    TTL_CALENDAR,
    TTL_DIRECTORY,
    TTL_DISCLOSURES,
    TTL_METRICS,
    TTL_PROFILE,
    TTL_REFERENCE,
    TTL_SNAPSHOT,
    TTL_STATEMENTS,
    _failure,
    _get_kap_directory,
    _kap_company,
    _parse_kap_directory,
    _require_listed,
    get_kap_company_titles,
)
from src.adapters.fundamentals_reference import (  # noqa: F401
    _disclosure_records,
    _dividend_records,
    _fetch_disclosures,
    _fetch_earnings_dates,
    _get_price_targets_raw,
    _get_sermaye_items,
    get_analyst_price_targets,
    get_dividends,
    get_earnings_dates,
    get_live_news,
    get_major_holders,
    get_recommendations,
)
from src.adapters.fundamentals_snapshot import (  # noqa: F401
    _get_company_metrics,
    _get_company_profile,
    _get_market_snapshot,
    _shares_outstanding,
    _snapshot_from_scan,
    _yfinance_info,
    get_company_info,
    get_fast_info,
)
from src.adapters.fundamentals_statements import (  # noqa: F401
    _discrete_rows,
    _filter_kap_periods,
    _get_isyatirim_quarterly,
    _get_kap_financial_summary,
    _load_statement_sources,
    _merged_canonical_by_period,
    _parse_kap_financial_summary,
    _ratio_shares,
    _restatement_factors,
    _scaled_items,
    _statement_view,
    _supplement_rows,
    compute_live_ratios,
    get_balance_sheet,
    get_cashflow,
    get_income_statement,
    get_live_financial_ratios,
)

__all__ = [
    "compute_live_ratios",
    "get_analyst_price_targets",
    "get_balance_sheet",
    "get_cashflow",
    "get_company_info",
    "get_dividends",
    "get_earnings_dates",
    "get_fast_info",
    "get_income_statement",
    "get_kap_company_titles",
    "get_live_financial_ratios",
    "get_live_news",
    "get_major_holders",
    "get_recommendations",
]
