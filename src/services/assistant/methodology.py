"""How the app computes what it shows — the assistant's methodology knowledge base.

The formulas mirror the code that produces the numbers (keep them in sync):

* ratios: :func:`src.services.analysis_service.compute_financial_ratios` and
  :func:`~src.services.analysis_service.derive_financial_amounts`;
* the stock scorecard ("Şirket analiz karnesi"):
  ``dashboard/src/components/stock/FinancialHealthScorecard.tsx`` (re-implemented in
  :mod:`src.services.assistant.scorecard`);
* concept pages: ``dashboard/src/lib/atlas.ts`` (``/atlas/<slug>``) and the guide
  (``/rehber?konu=<id>``).

``tests/unit/test_assistant.py`` checks that every Atlas slug and guide id used here
still exists in the dashboard sources.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from src.services.event_service import fold_turkish


@dataclass(frozen=True)
class MethodologyEntry:
    id: str
    title: str
    formula: str | None
    how: str  # how Hisse Analizi computes / sources it
    url: str  # internal page that explains it
    keywords: tuple[str, ...]


ENTRIES: tuple[MethodologyEntry, ...] = (
    MethodologyEntry(
        id="fk",
        title="F/K (Fiyat / Kazanç)",
        formula="F/K = Piyasa Değeri / Ana ortaklık net kârı (TTM)",
        how=(
            "Piyasa değeri = son fiyat × pay adedi (ödenmiş sermaye; bedelsiz/bedelli sonrası piyasa pay adedi). "
            "Net kâr son 12 ay (TTM) ana ortaklık payıdır. Net kâr sıfır veya negatifse F/K hesaplanmaz (zarar). "
            "Hisse sayfasındaki fiyat özeti F/K'yı TradingView'in konsolide TTM çarpanından alır; temel analiz "
            "oranları KAP tablolarından hesaplanır, bu yüzden iki değer çeyrek açıklama dönemlerinde biraz farklı olabilir."
        ),
        url="/atlas/fk-orani",
        keywords=("f/k", "fk", "p/e", "pe", "fiyat kazanc", "carpan", "pe ratio"),
    ),
    MethodologyEntry(
        id="pddd",
        title="PD/DD (Piyasa Değeri / Defter Değeri)",
        formula="PD/DD = Piyasa Değeri / Ana ortaklığa ait özkaynaklar (son bilanço)",
        how=(
            "Özkaynak son açıklanan bilançodaki ana ortaklığa ait özkaynaktır (yoksa toplam özkaynak). "
            "Özkaynak negatifse PD/DD hesaplanmaz."
        ),
        url="/atlas/pddd-orani",
        keywords=("pd/dd", "pddd", "p/b", "pb", "defter degeri", "piyasa degeri defter"),
    ),
    MethodologyEntry(
        id="fd-favok",
        title="FD/FAVÖK (Firma Değeri / FAVÖK)",
        formula="FD/FAVÖK = (Piyasa Değeri + Net Borç + Kontrol gücü olmayan paylar) / FAVÖK (TTM)",
        how=(
            "FAVÖK = esas faaliyet kârı + amortisman ve itfa payları (nakit akış tablosundan), son 12 ay. "
            "Net borç = finansal borçlar − nakit ve nakit benzerleri − kısa vadeli finansal yatırımlar (son bilanço). "
            "FAVÖK sıfır/negatifse hesaplanmaz; banka ve sigorta şirketlerinde gösterilmez."
        ),
        url="/atlas/fd-favok",
        keywords=("fd/favok", "fd favok", "ev/ebitda", "ev ebitda", "firma degeri", "favok", "ebitda"),
    ),
    MethodologyEntry(
        id="net-borc-favok",
        title="Net Borç / FAVÖK ve Cari Oran",
        formula="Net Borç / FAVÖK = (Finansal borçlar − Nakit − KV finansal yatırımlar) / FAVÖK (TTM) · Cari Oran = Dönen Varlıklar / KV Yükümlülükler",
        how="Son bilanço ve son 12 ay FAVÖK ile hesaplanır; bankalarda anlamlı olmadığı için hesaplanmaz.",
        url="/atlas/net-borc-favok",
        keywords=("net borc", "net debt", "cari oran", "current ratio", "likidite", "borcluluk"),
    ),
    MethodologyEntry(
        id="borc-ozkaynak",
        title="Borç / Özkaynak",
        formula="Borç / Özkaynak = Toplam Yükümlülükler / Toplam Özkaynaklar",
        how="Son bilanço kalemleriyle hesaplanır; özkaynak negatifse hesaplanmaz. Bankalarda gösterilmez.",
        url="/atlas/net-borc-favok",
        keywords=("borc ozkaynak", "debt to equity", "d/e", "kaldirac"),
    ),
    MethodologyEntry(
        id="roe",
        title="ROE (Özkaynak Kârlılığı) ve ROA",
        formula="ROE (%) = Ana ortaklık net kârı (TTM) / Ortalama ana ortaklık özkaynağı × 100 · ROA (%) = Net kâr (TTM) / Ortalama toplam varlıklar × 100",
        how="Ortalama = dönem sonu ile bir yıl önceki bilançonun ortalaması (önceki yoksa dönem sonu).",
        url="/atlas/roe-ozkaynak-karliligi",
        keywords=("roe", "roa", "ozkaynak karliligi", "aktif karliligi", "return on equity"),
    ),
    MethodologyEntry(
        id="marjlar",
        title="Brüt, faaliyet, FAVÖK ve net kâr marjı",
        formula="Marj (%) = Kâr kalemi (TTM) / Hasılat (TTM) × 100",
        how=(
            "Brüt kâr, esas faaliyet kârı, FAVÖK ve net dönem kârı son 12 ay hasılatına bölünür. "
            "Banka ve sigorta şirketlerinde hasılat tanımı farklı olduğu için marjlar hesaplanmaz."
        ),
        url="/atlas/banka-ve-sanayi-oranlari",
        keywords=("marj", "brut kar marji", "net kar marji", "faaliyet marji", "favok marji", "margin"),
    ),
    MethodologyEntry(
        id="fs",
        title="F/S (Fiyat / Satış)",
        formula="F/S = Piyasa Değeri / Hasılat (TTM)",
        how="Banka ve sigorta şirketlerinde hesaplanmaz.",
        url="/atlas/fd-favok",
        keywords=("f/s", "fiyat satis", "p/s", "ps ratio"),
    ),
    MethodologyEntry(
        id="buyume",
        title="Hasılat ve net kâr büyümesi (yıllık)",
        formula="Büyüme (%) = (Bu dönem TTM / Bir yıl önceki aynı TTM − 1) × 100",
        how=(
            "Nominal TL ile hesaplanır, enflasyondan arındırılmaz. Önceki dönem değeri sıfır veya negatifse "
            "(zarardan kâra geçiş) büyüme hesaplanmaz."
        ),
        url="/atlas/ttm-son-12-ay",
        keywords=("buyume", "growth", "hasilat buyumesi", "kar buyumesi", "yoy"),
    ),
    MethodologyEntry(
        id="ttm",
        title="TTM (Son 12 Ay)",
        formula="TTM = Bu yılın kümülatif ara dönemi + Önceki mali yıl − Önceki yılın aynı ara dönemi",
        how=(
            "Akım kalemleri (hasılat, kâr, FAVÖK) son dört çeyreğin toplamıdır; stok kalemleri (varlık, borç, "
            "özkaynak) son bilançodan alınır. TMS 29 (enflasyon muhasebesi) uygulayan şirketlerde ara dönemler "
            "TÜFE ile yeniden ifade edilir."
        ),
        url="/atlas/ttm-son-12-ay",
        keywords=("ttm", "son 12 ay", "trailing", "kumulatif", "tms 29", "enflasyon muhasebesi"),
    ),
    MethodologyEntry(
        id="karne",
        title="Şirket analiz karnesi (1-5 puan)",
        formula="Kategori puanı = göstergelerin ortalaması · Genel puan = puanlanabilen kategorilerin ortalaması",
        how=(
            "Her gösterge eşiklere göre 1-5 puan alır (verisi olmayan gösterge/kategori sayılmaz). "
            "Kârlılık: ROE ≥30→5, ≥20→4, ≥10→3, ≥0→2, aksi 1; net marj ≥15→5, ≥8→4, ≥3→3, ≥0→2. "
            "Büyüme: hasılat ve net kâr büyümesi ≥50→5, ≥30→4, ≥15→3, ≥0→2. "
            "Finansal sağlık: cari oran ≥2→5, ≥1,5→4, ≥1→3, ≥0,8→2; borç/özkaynak ≤0,5→5, ≤1→4, ≤2→3, ≤3→2; "
            "net borç/FAVÖK ≤0→5, ≤1→4, ≤2,5→3, ≤4→2. "
            "Değerleme: F/K ≤8→5, ≤12→4, ≤18→3, ≤25→2 (zarar eden şirkette 1); PD/DD ≤1→5, ≤2→4, ≤3→3, ≤5→2 (negatifse 1). "
            "Teknik trend: günlük teknik özet Güçlü al 5, Al 4, Nötr 3, Sat 2, Güçlü sat 1. "
            "Eşikler nominal TL verileri için basit kurallardır, sektör farklarını yansıtmaz; karne yatırım tavsiyesi değildir."
        ),
        url="/rehber",
        keywords=("karne", "analiz karnesi", "skor", "puan", "scorecard", "yildiz", "genel puan"),
    ),
    MethodologyEntry(
        id="teknik-ozet",
        title="Günlük teknik özet (AL/SAT/NÖTR sinyali)",
        formula="Özet = osilatörler + hareketli ortalamalar oylaması (TradingView teknik derecelendirmesi)",
        how=(
            "TradingView'in günlük teknik derecelendirmesi kullanılır: 11 osilatör (RSI, Stokastik, CCI, ADX, MACD…) "
            "ve 15 hareketli ortalama (EMA/SMA 10-200, Ichimoku, VWMA, HullMA) al/sat/nötr oyu verir; toplam puana göre "
            "Güçlü al … Güçlü sat etiketi oluşur. Bir öneri değil, göstergelerin mekanik özetidir."
        ),
        url="/rehber?konu=rsi",
        keywords=("teknik ozet", "sinyal", "al sat", "teknik derecelendirme", "osilator", "hareketli ortalama"),
    ),
    MethodologyEntry(
        id="rsi",
        title="RSI (14)",
        formula="RSI = 100 − 100 / (1 + Ortalama kazanç / Ortalama kayıp)",
        how="Wilder düzleştirmeli 14 günlük RSI; 30 altı aşırı satım, 70 üstü aşırı alım bölgesi kabul edilir.",
        url="/atlas/rsi",
        keywords=("rsi", "goreli guc", "asiri alim", "asiri satim", "momentum"),
    ),
    MethodologyEntry(
        id="sma",
        title="SMA 50/200 ve kesişimler",
        formula="SMA(n) = son n günlük kapanışların aritmetik ortalaması",
        how="Altın kesişim: SMA 50'nin SMA 200'ü yukarı kesmesi; ölüm kesişimi: aşağı kesmesi.",
        url="/atlas/sma-kesisimleri",
        keywords=("sma", "hareketli ortalama", "altin kesisim", "olum kesisimi", "golden cross", "death cross"),
    ),
    MethodologyEntry(
        id="temettu",
        title="Temettü verimi",
        formula="Temettü verimi (%) = Son 12 ay hisse başına brüt nakit temettü / Hisse fiyatı × 100",
        how="Temettü geçmişi İş Yatırım ve KAP temettü bildirimlerinden alınır.",
        url="/atlas/temettu-verimi",
        keywords=("temettu", "kar payi", "dividend", "temettu verimi"),
    ),
    MethodologyEntry(
        id="reel-getiri",
        title="Reel getiri",
        formula="Reel getiri = (1 + Nominal getiri) / (1 + Enflasyon) − 1",
        how="Grafiklerdeki Reel birimi fiyatları TÜFE ile son açıklanan ayın liralarına çevirir.",
        url="/atlas/reel-getiri",
        keywords=("reel getiri", "enflasyondan arindirilmis", "real return", "reel"),
    ),
    MethodologyEntry(
        id="sektor-medyani",
        title="Sektör medyanı",
        formula="Medyan = KAP sektöründeki şirket değerlerinin ortanca değeri",
        how="En az 3 şirket gerekir; F/K ve PD/DD medyanlarında yalnızca pozitif değerler sayılır.",
        url="/atlas/sektor-medyani",
        keywords=("sektor medyani", "medyan", "emsal", "sektor ortalamasi", "peer"),
    ),
    MethodologyEntry(
        id="banka",
        title="Banka ve sanayi şirketlerinde oran farkları",
        formula=None,
        how=(
            "Banka, sigorta ve diğer finansal şirketlerde marjlar, cari oran, borçluluk ve FD/FAVÖK hesaplanmaz; "
            "F/K, PD/DD, ROE, ROA ve net kâr büyümesi gösterilir."
        ),
        url="/atlas/banka-ve-sanayi-oranlari",
        keywords=("banka", "sigorta", "finansal sirket", "bank"),
    ),
    MethodologyEntry(
        id="kap",
        title="KAP bildirimleri ve önem seviyesi",
        formula=None,
        how=(
            "KAP bildirimleri kategori (temettü, sermaye artırımı, finansal rapor…) ve önem (Bilgi, İzle, Yüksek) "
            "ile sınıflandırılır; kurallar bildirim başlığı ve KAP özetine bakar."
        ),
        url="/rehber?konu=kap",
        keywords=("kap", "bildirim", "ozel durum", "onem", "severity", "disclosure"),
    ),
    MethodologyEntry(
        id="veri-gecikmesi",
        title="Seans saatleri ve veri gecikmesi",
        formula=None,
        how=(
            "BIST pay piyasası hafta içi 10:00-18:00 (İstanbul) açıktır; ücretsiz fiyat akışı yaklaşık 15 dakika "
            "gecikmelidir. Kaynağa ulaşılamazsa son geçerli veri tarihiyle gösterilir."
        ),
        url="/rehber?konu=seans",
        keywords=("gecikme", "seans", "canli", "veri kaynagi", "delay", "guncel mi"),
    ),
    MethodologyEntry(
        id="enflasyon",
        title="Enflasyon (TÜFE/ÜFE)",
        formula=None,
        how="TÜİK TÜFE ve ÜFE yıllık/aylık değişimleri; Makro sayfasında politika faiziyle birlikte gösterilir.",
        url="/rehber?konu=enflasyon",
        keywords=("enflasyon", "tufe", "ufe", "cpi", "inflation"),
    ),
    MethodologyEntry(
        id="politika-faizi",
        title="Politika faizi (TCMB 1 hafta repo)",
        formula=None,
        how="TCMB Para Politikası Kurulu kararları ve faiz koridoru (gecelik borç verme/borçlanma).",
        url="/rehber?konu=politika-faizi",
        keywords=("politika faizi", "faiz", "ppk", "tcmb", "repo", "policy rate", "koridor"),
    ),
)

# Atlas slugs and guide ids referenced above (verified against the dashboard sources in tests).
ATLAS_SLUGS: frozenset[str] = frozenset(
    match.group(1) for entry in ENTRIES if (match := re.fullmatch(r"/atlas/([a-z0-9-]+)", entry.url))
)
GUIDE_IDS: frozenset[str] = frozenset(
    match.group(1) for entry in ENTRIES if (match := re.fullmatch(r"/rehber\?konu=([a-z0-9-]+)", entry.url))
)

_WORD_RE = re.compile(r"[a-z0-9/]+")


def _fold(text: str) -> str:
    return fold_turkish(text).lower()


def search(query: str, limit: int = 3) -> list[MethodologyEntry]:
    """Best-matching entries for a free-text topic (keyword overlap, Turkish-insensitive)."""
    folded = _fold(query)
    words = set(_WORD_RE.findall(folded))
    scored: list[tuple[int, int, MethodologyEntry]] = []
    for index, entry in enumerate(ENTRIES):
        score = 0
        for keyword in entry.keywords:
            if " " in keyword or "/" in keyword:
                score += 3 if keyword in folded else 0
            elif keyword in words:
                score += 2
        if entry.id in words:
            score += 1
        if score:
            scored.append((score, -index, entry))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [entry for _score, _index, entry in scored[:limit]]


def by_id(entry_id: str) -> MethodologyEntry | None:
    return next((entry for entry in ENTRIES if entry.id == entry_id), None)
