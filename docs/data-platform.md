# Veri Platformu (data-infra) — mimari ve çalışma kuralları

Bu belge `data-infra` branch'inde yürütülen veri altyapısı çalışmasının ortak sözleşmesidir.
Bu branch'te çalışan **her ajan önce bu belgeyi okur**; burada yazmayan bir kuralı
uydurmaz, burada yazan bir kuralı esnetmez.

## 1. Hedef

Uygulamanın gösterdiği her veri için:

1. **Doğruluk** — değer birincil/resmî kaynakla tutarlı olmalı ve bu tutarlılık *ölçülmeli*
   (çapraz kaynak kontrolleri `data_quality_checks` tablosuna yazılır).
2. **Kalıcılık ve köken** — veri PostgreSQL'de, kanonik biçimde, `source` + `fetched_at`
   (köken) ve verinin kendi tarihi (`bar_date`, `observation_date`, `as_of`, `period`) ile saklanır.
3. **Dayanıklılık** — sağlayıcı çöktüğünde sayfa çökmez: saklanan son iyi kopya
   `stale: true` işaretiyle servis edilir; işlem yeniden başlayınca cache soğumaz.
4. **Sözleşme sürekliliği** — mevcut API yanıt alanları **asla yeniden adlandırılmaz/kaldırılmaz**;
   yalnızca alan **eklenir**. Frontend (dashboard/) bu branch'te DEĞİŞTİRİLMEZ (başka oturumların
   sahipliğinde; birleştirmede master sürümü korunur).

Mevcut durum (v1.0.0): neredeyse her veri istek anında üçüncü taraftan çekilip 30 sn–6 sa
bellek içi TTL cache'te tutuluyor; DB'de yalnızca BIST 100 şirketleri, borsapy+yfinance
karışık günlük barlar, İş Yatırım'ın *yeniden ifade edilmiş* yıllık tabloları ve bunlardan
hesaplanan oranlar, KAP olayları ve haberler var. "Store-first" tasarıma geçiyoruz.

## 2. Doğrulanmış kaynak gerçekleri (2026-09-22/23, piyasa kapalıyken ölçüldü)

| Kaynak | Uç nokta | Bulgu |
|---|---|---|
| TradingView tarayıcı | `POST scanner.tradingview.com/turkey/scan` (`src/adapters/utils.tradingview_scan`) | 614–626 BIST hissesi tek istekte 0,3 sn; `update_mode = delayed_streaming_900` (**15 dk gecikmeli**). Kapanış/önceki kapanış İş Yatırım ve Yahoo günlük geçmişiyle birebir (GARAN 21.09 kapanış 133,10). `market_cap_basic` doğru; `total_shares_outstanding` bazen yanlış (KCHOL 1,86 mr yerine 2,55 mr). `isin`, `sector.tr`, `industry.tr`, `type/subtype` alanları var. Günlük bar (open/high/low/close/volume) tüm evren için tek istekte alınabilir. |
| TradingView websocket (borsapy `Ticker.history`) | `wss://data.tradingview.com` | Barlar **split/bedelsiz düzeltmeli** (`"adjustment": "splits"`), temettü düzeltmesi yok; `period` gerçek takvim değil bar sayısı; sembol başına ~2 sn. |
| İş Yatırım günlük geçmiş | `GET .../Common/Data.aspx/HisseTekil?hisse=GARAN&startdate=15-09-2026&enddate=22-09-2026` | 0,1 sn; resmî günlük seri: `HGDG_KAPANIS` (kapanış), `HGDG_AOF` (AOF/VWAP), `HGDG_MIN/MAX`, `HGDG_HACIM` (TL ciro), `PD` (piyasa değeri), `HAO_PD` (halka açık PD), `DOLAR_BAZLI_FIYAT`, `END_DEGER` (aynı gün XU100). **Doğrulandı (WS2):** `HG_*` = işlem gördüğü fiyat (düzeltmesiz; TradingView ile 566/566 birebir, bedelsiz öncesinde HG × bölünme katsayısı), `HGDG_*` = bölünme **ve temettü** düzeltmeli (temettü sonrası TV'den %0,6–2,5 sapar). Bu yüzden İşY yalnızca `turnover` (`HG_HACIM`, TL) ve `vwap` (`HG_AOF`, saklanan baza ölçeklenir), kapanış çapraz kontrolü ve boşluk yedeği için kullanılır; çok yıllık pencerelerde 1–6 sn yanıt verir ve günün satırı akşam geç (D+1) gelir. Hacim birimleri: TV `volume` = lot (bölünme düzeltmeli; Yahoo ile birebir), İşY `HG_HACIM` = TL, lot = `HG_HACIM / HG_AOF` (TV/İşY lot oranı medyan 0,99999994); TV `Value.Traded` = kapanış × lot, gerçek ciro değildir. TV aynı gün hacmi kapanış seansı işlemlerini kaçırır (SASA −20.000.000 lot, KCHOL −607.900) ve `update_time` kapanıştan sonra da ilerler → sembol bazlı yanıtlar ve günün son barı OneEndeks `quantity` (lot) / `volume` (TL) kullanır, zaman damgası 18:10 seans kapanışında sabitlenir (`session_state: open|closed`). OneEndeks gece sıfırlanır (lot/TL/high/low/bid/ask = 0, önceki günün damgasıyla): sıfırlanmış satır asla saklanmaz ve yedek kotasyon olarak kullanılmaz. OneEndeks `capital` (ödenmiş sermaye, 1 TL nominal = pay adedi) ve `equity` (son çeyrek ana ortaklık özkaynağı) pay adedi ve PD/DD için resmî girdidir; TV `price_book_fq` (hazine payı hariç pay adedi ile) yalnızca yedek, `price_book_ratio` (yıl sonu özkaynağı) hiç kullanılmaz. |
| İş Yatırım kotasyon | `GET .../Common/Data.aspx/OneEndeks?endeks=GARAN` (borsapy `get_realtime_quote`, deprecated ama çalışıyor) | 0,1 sn; `last, open, high, low, close(=önceki kapanış), volume(TL), quantity(lot), bid, ask, week/month/year close, updateDate`. TV ile birebir. Çapraz kontrol ve yedek kaynak olarak ideal. |
| İş Yatırım MaliTablo | `src/adapters/financial_adapter.fetch_isyatirim_financials` | 4 dönem/istek; bankalarda solo (konsolide değil). **IAS 29 (WS3 takibi ile doğrulandı):** İşY yıl sonu kolonlarını *her* şirket için yeniden ifade eder (2025/12 ×0,8492, 2024/12 ×0,7640, 2023/12 ×0,6926); enflasyon muhasebesi uygulayan şirketlerde ayrıca **önceki yıl ara dönem** kolonları (2025/06, 2025/03, 2024/09…) gelir tablosu ve nakit akışında güncel raporun yeniden ifade edilmiş karşılaştırmalarıdır, bilanço ilk açıklanan haliyle kalır. Kolon başına geri çevirme katsayısı = bilanço dönem kârı (2OCF) / gelir tablosu ana ortaklık payı (3Z), aynı dönemin şirketler arası medyanıyla teyit edilir (BIMAS 2025/06 hasılat × 0,75698 = KAP ile birebir). Yeniden sunulmuş karşılaştırmalarda (oran medyandan sapar) ana ortaklık net kârı 2OCF'den alınır, esas faaliyet kârı/toplam net kâr/nakit akışları boş bırakılır. 2023/12 öncesi ara dönemler tarihî maliyetle açıklandığı için çevrilemez (`restatement_factor` NULL). |
| TÜİK aylık TÜFE (makro deposu `tuik.cpi.mom`) | `financial_adapter.cpi_quarter_factors` | **TMS 29 tek çeyrek ve TTM (24.09 doğrulandı):** enflasyon muhasebesi uygulayan şirketin her raporu kendi dönem sonu satın alma gücündedir; 3 aylık kolon = kümülatif − önceki kümülatif × TÜFE(çeyrek sonu) ÷ TÜFE(önceki çeyrek sonu). Üç aylık değişimin çarpımı KAP'la birebir (BIMAS 2026/06: 1,07010, rapordan 1,07014; 2026/Ç2 hasılatı KAP 3 aylık kolonu 221.902,6 mn, düz fark 236.832,9 mn). 4. çeyrek = yıllık − 9 aylık (yıllık raporda 3 aylık kolon yok; TradingView/FactSet de böyle türetir). TTM = son dört çeyreğin toplamı: 27 çekirdek TMS 29 şirketinde TradingView `total_revenue_ttm` ile hasılat 26/27 %0,3 içinde (önce medyan %4,6 sapma), ana ortaklık net kârı 24/27 %2 içinde. TMS 29 uygulayan şirket = İşY ara dönem kolonu yeniden ifade edilmiş (`fundamentals_statements.applies_ias29`); USD fonksiyonel (THYAO, PGSUS, EREGL, BRSAN), banka ve sigortacılar düz farkla kalır. TradingView F/K'sı bedelsiz sonrası eski pay sayısıyla bozuk olabilir (EFOR 9,46, ALTNY 45,3; kendi `net_income_ttm`'iyle çelişir). |
| İş Yatırım şirket kartı | `sirket-karti.aspx?hisse=X` (borsapy `get_company_metrics`) | 2–3 sn; halka açıklık, yabancı oranı, PD, F/K, PD/DD. `_fetch_sermaye_data` (temettü/sermaye artırımı/öneri) ~10 sn. |
| KAP finansal özet | `kap.org.tr/tr/sirket-finansal-bilgileri/<oid>` | Resmî, ilk açıklanan haliyle; sunum birimi kolon başına; 3 yıl sonu + son ara dönem. |
| Borsa İstanbul endeks bileşenleri | `https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv` | Resmî; 5.750 satır (`BILESEN KODU;BULTEN_ADI;ENDEKS KODU;ENDEKS ADI;ENDEKS INGILIZCE ADI;TARIH`), tüm endeksler (XU100/XU030/XBANK/sektör...). `AEFES.E` → `AEFES`. |
| TCMB | faiz sayfaları (borsapy `TCMB().history`), `kurlar/today.xml` + arşiv, TÜFE tablosu | Politika faizi = tarihe göre EN SON satır (borsapy kısayolu 2010 satırını verir). EVDS3 REST (`evds3.tcmb.gov.tr`, ücretsiz anahtar) resmî yapısal kaynak — borsapy `evds.py` sarmalıyor. Anahtar yoksa scraping devam eder. |
| KAP bildirimleri | — | **Kapsam dışı.** "Kap haberleri sayfası iyileştirmesi" oturumu master'da tek istekli `POST /tr/api/disclosure/members/byCriteria` akışını yazıyor (kap.py, event_service.py, EventCategory, NormalizedEvent, /events*, migration 010). Bu branch'te dokunulmaz. |
| Yahoo Finance | `yfinance` | `fast_info.previousClose` güvenilmez (GARAN 132,9 vs resmî 133,1); günlük `history()` doğru; KCHOL pay adedi doğru. Yalnızca yedek/çapraz kontrol. |

## 3. Şema (migration `020_data_platform`, `src/db/models.py`)

Modeller **dondurulmuştur**: yeni kolon/tablo gerekiyorsa yalnızca kendi alanınıza ait
bölümde eklemeli değişiklik + zincire eklenen yeni bir migration (`021`, `022`... revision
kısa numara) yazın ve raporunuzda belirtin. `alembic check` (model–şema farkı yok) ve
`upgrade → downgrade base → upgrade` gidiş-dönüşü yeşil kalmalı.

| Tablo | Anahtar | Sahibi | Not |
|---|---|---|---|
| `companies` | ticker | WS1 (kimlik/referans kolonları), WS3 (`fiscal_year_end_month`, `statement_template`, `paid_in_capital`) | Kolon bazlı sahiplik: **yalnızca kendi kolonlarınızı UPDATE edin** (tam satır upsert yok). `tracking_tier`: `core` (BIST 100, şirket başına poll) / `universe`. `is_active` = evrende ve listede. |
| `market_indices`, `index_memberships` | code / (index_code, ticker) | WS1 | Borsa İstanbul CSV'sinden; her yenilemede tam değiştir. |
| `quotes` | symbol | WS2 | Sembol başına son kotasyon (hisse + endeks). `quote_time` sağlayıcı saati, `session_date` İstanbul seans günü, `delay_seconds` = 900 (TV). |
| `price_bars` | (symbol, interval, bar_date) | WS2 | Sembol başına TEK seri (`source` anahtarda değil). Günlük TV barları split düzeltmeli; İşY'den `turnover`, `vwap`. Haftalık/aylık barlar saklanmaz, günlükten türetilir. `is_final=false` yalnızca süren seans. |
| `financial_statements` | (company_id, source, period, statement_type) | WS3 | `source ∈ {kap, isyatirim}`, `period = "YYYY/MM"`, `statement_type ∈ {balance_sheet, income_stmt, cash_flow}`, `items_json` = sıralı satırlar `{code, label, key, value}` (TL). `restated` + `restatement_factor` (= KAP / İşY; yıl sonu) ya da kolon bazlı 2OCF/3Z katsayısı (önceki yıl ara dönem; bkz. §2) **tablo türü başına**: yalnızca fiilen yeniden ifade edilen gelir tablosu/nakit akışı satırları işaretlenir, katsayı bilinmiyorsa NULL. Kalemler yalnızca KAP ile son iki ortak dönemde eşleşen İşY satırlarından beslenir (banka/sigorta kapsam farkında yalnızca KAP); `financial_facts.sources_json` her kalemin kaynak kolonunu kaydeder. `companies.statement_template ∈ {industrial, bank, insurance, ...}`. Liste uçları `meta`'yı `X-Data-Meta` başlığında taşır. |
| `financial_facts` | (company_id, period) | WS3 | Kanonik kalemler (FLOW_KEYS + STOCK_KEYS), **ilk açıklanan (KAP) bazında**; akımlar mali yıl başından kümülatif, `months` ile. |
| `financial_ratios` | (company_id, period, basis) | WS3 | `basis ∈ {ttm, annual}`; 15 oran + `market_cap/price/shares_outstanding/shares_source`, `ttm_quarters`, `inputs_json` (denetim izi). |
| `dividends`, `capital_increases`, `shareholders`, `analyst_targets`, `expected_disclosures` | bkz. model | WS1 | Şirket başına yenilemede `shareholders` tamamen değiştirilir; diğerleri upsert. `capital_increases.kind` (İşY tip kodu): `rights` (01 bedelli), `bonus` (02/09 bedelsiz), `rights_bonus` (03 bedelli+bedelsiz), `private` (07 tahsisli). `shareholders.source`: `kap` (çekirdek şirketler, MKK/KAP ≥%5 ortaklar) veya `isyatirim`. `analyst_targets.source`: `isyatirim` (kurumun kendi hedefi, `target_mean`) veya `hedeffiyat` (konsensüs; `median` DB'de NULL, API'de uyumluluk için (low+high)/2). |
| `macro_series` | (series_code, observation_date) | WS4 | Seri kodları: `tcmb.policy_rate`, `tcmb.overnight.borrowing/lending`, `tcmb.late_liquidity.borrowing/lending`, `tuik.cpi.yoy`, `tuik.cpi.mom`, `tuik.ppi.yoy`, `tuik.ppi.mom` (+ EVDS varsa `evds.<seri>`). |
| `fx_bulletins` | (bulletin_date, currency) | WS4 | TCMB günlük bülten, 1 birime normalize. |
| `data_snapshots` | key | WS6 (yardımcı), herkes (kullanım) | Modellenmemiş canlı payload'ların son iyi kopyası (`src/services/snapshots.py`). |
| `ingestion_runs` | id | WS0 (`src/services/ingestion.run_job`) | Her worker döngüsü/işi bir satır. `market.bars.daily` → `price`, `fundamentals.statements` → `financials` `polling_state` satırlarını da günceller. |
| `data_quality_checks` | id | WS6 | Çapraz kaynak kontrol sonuçları (`pass/warn/fail`). |

Mevcut tablolar (`raw_events`, `normalized_events`, `news_items`, `event_outbox`,
`notifications`, `sources`, `polling_state`, `ai_usage`) değişmedi.

## 4. Ortak desenler

### 4.1 Store-first okuma (`read-through`)

Her veri kümesi için tek bir servis fonksiyonu: 

```
async def get_X(session, key, *, max_age: timedelta) -> tuple[payload, DataMeta]:
    row = await repo.get(key)
    if row and age(row) <= max_age:            -> served_from="store"
        return row_payload, meta(store)
    try:
        fresh = await fetch_live(key)           # mevcut adaptör çağrısı
        await repo.upsert(fresh); commit
        return fresh, meta(live)               -> served_from="live"
    except MarketDataError / httpx errors:
        if row:                                 -> served_from="stale", stale=True
            return row_payload, meta(stale, notes=["Sağlayıcıya ulaşılamadı; son kayıtlı veri"])
        raise
```

Kurallar: `None`/hata payload'ları saklanmaz; canlı çekim başarısızsa ve depo boşsa mevcut
hata sözleşmesi (`{"error": <Türkçe>, "error_status": 502/503/404}`) aynen korunur.
Bellek içi `cached` TTL katmanı **kalır** (tek uçuş + kısa TTL); depo onun altındaki L2'dir.

### 4.2 `meta` bloğu

Her yanıt `src/core/meta.py:with_meta()` ile **eklemeli** bir `meta` taşır:
`source, source_url, as_of, fetched_at, age_seconds, served_from(live|store|stale), stale, delay_seconds, notes`.
Mevcut üst düzey `source`/`as_of` alanları kaldırılmaz.

### 4.3 İş (job) kaydı

Worker döngüleri `async with run_job("market.quotes", scope="universe") as run:` ile sarılır;
`run.items_total/ok/failed` ve `run.details` doldurulur. İş adları `alan.işlem[.alt]`:
`universe.sync`, `market.quotes`, `market.bars.daily`, `market.bars.backfill`,
`fundamentals.statements`, `fundamentals.ratios`, `reference.company`, `macro.rates`,
`macro.inflation`, `macro.fx`, `quality.daily`.

### 4.4 Worker döngüleri

Her alan kendi modülünde: `src/workers/<alan>_worker.py` içinde
`async def <alan>_loop(stop: asyncio.Event) -> None` (kooperatif durdurma:
`src.workers.polling_worker.sleep_or_stop` kullanın) ve el ile/yönetici tetiklemesi için
`async def run_<alan>_once(...) -> dict`. **`run_workers.py` ve `polling_worker.py`'ye
dokunmayın** — kablolamayı entegrasyonda WS0 yapar. Zamanlamalar Europe/Istanbul'a göre
(`src/adapters/price.now_istanbul`, `is_session_final`). Aynı anda tek örnek garantisi
gerekiyorsa `polling_worker.source_lock("<iş adı>")` advisory kilidi kullanılabilir.

### 4.5 Kod ve veri kuralları

* Para TL (tam birim), oranlar yüzde (`14.85`), çarpanlar düz oran, pay adedi tam sayı.
  `Decimal` kolonlara `float` yazarken NaN/Inf asla gitmez (`finite_float`/`to_number`).
* Eksik veri `None`; hiçbir zaman `0` uydurulmaz.
* Kullanıcıya dönen hata metinleri Türkçe ve kısa; ham exception metni sızmaz.
* Yeni ayarlar `src/core/config.py`'ye **eklemeli** ve alan önekli (`MARKET_*`, `FUNDAMENTALS_*`,
  `REFERENCE_*`, `MACRO_*`, `QUALITY_*`); `.env.example`'a açıklamayla eklenir.
* Yeni repository'ler `src/db/repositories/<alan>.py` (mevcut `src/db/repository.py`'de
  yalnızca kendi alanınıza ait sınıf değiştirilebilir).
* Yeni API uçları kendi router modülünüzde (`src/api/routers_<alan>.py`); `app.py`'de
  yalnızca `include_router` satırı eklenir. Var olan uçların yolu/alanları korunur.
* `ruff check src tests`, `mypy src`, `SKIP_NETWORK_TESTS=1 pytest -q` yeşil kalır.
* Testler: ağ erişimi olmayan birim testleri + `pg_session` fixture'ı (tests/conftest.py;
  `TEST_DATABASE_URL`, yerelde `hisse_analizi_test`) ile gerçek Postgres davranışı
  (ON CONFLICT, NUMERIC, JSONB). Canlı sağlayıcı testleri `tests/integration/`
  (`@pytest.mark.integration`, `SKIP_NETWORK_TESTS=1` ile atlanır).
* Git: **commit atmayın, stash kullanmayın, branch değiştirmeyin**; entegrasyonu WS0 yapar.
  Yalnızca kendi dosyalarınızı düzenleyin. Başka bir alana ait dosyada değişiklik gerekiyorsa
  raporunuzda "İSTEK: <dosya> — <değişiklik>" olarak yazın.

## 5. İş paketleri ve dosya sahipliği

| WS | Kapsam | Sahip olduğu dosyalar |
|---|---|---|
| WS0 (orkestratör) | şema, migration 020, `src/core/meta.py`, `src/services/ingestion.py`, conftest, entegrasyon (`run_workers.py`, `polling_worker.py` POLL_SOURCES, dokümantasyon, birleştirme) | — |
| WS1 universe-reference | şirket evreni + endeks üyelikleri + referans veriler + referans worker | `src/adapters/bist_reference.py` (yeni), `src/adapters/fundamentals_reference.py`, `src/services/universe_service.py`, `src/services/reference_service.py`, `src/db/repositories/reference.py`, `src/workers/reference_worker.py`, `scripts/seed.py` (asgari), `src/api/routers_fundamentals.py` (yalnızca referans uçları), `src/schemas/events.py` `CompanyOut` (eklemeli), `tests/unit/test_reference_*.py`, `tests/unit/test_universe_*.py` |
| WS2 market-store | kotasyon + bar deposu, store-first grafik/teknik, snapshot/fast-info | `src/adapters/price.py`, `src/adapters/index_adapter.py`, `src/adapters/stream_adapter.py`, `src/adapters/technical.py`, `src/adapters/fundamentals_snapshot.py`, `src/adapters/isyatirim_prices.py` (yeni), `src/services/market_service.py`, `src/db/repositories/market.py`, `src/db/repository.py` (`PriceDataRepository` bölümü), `src/services/event_service.py` (`PriceService` bölümü), `src/workers/market_worker.py`, `src/api/routers.py` (`/prices*` uçları), `tests/unit/test_market_*.py`, `test_price_service.py`, `test_technical_*.py` |
| WS3 fundamentals-store | tablo/kalem/oran deposu, store-first tablo görünümleri ve oranlar | `src/adapters/financial_adapter.py`, `src/adapters/fundamentals_statements.py`, `src/adapters/fundamentals_common.py`, `src/services/analysis_service.py`, `src/services/fundamentals_service.py` (yeni), `src/services/event_service.py` (`FinancialService` bölümü), `src/db/repositories/fundamentals.py`, `src/db/repository.py` (`FinancialStatementRepository`, `FinancialRatioRepository`, `StatsRepository`), `src/workers/fundamentals_worker.py`, `src/api/routers.py` (`/financials*`, `/admin/financials/*`), `src/api/routers_fundamentals.py` (tablo/oran uçları), `src/schemas/events.py` (`FinancialStatementOut`, `FinancialRatioOut`), `tests/unit/test_fundamentals_*.py`, `test_analysis_ratios.py`, `test_financial_hashing.py` |
| WS4 macro-store | TCMB faiz/koridor, TÜFE/ÜFE, kur deposu; EVDS isteğe bağlı | `src/adapters/macro.py` (**asgari** dokunuş — ekonomik takvim ve `/macro/calendar` başka oturumun; bkz. §2), `src/adapters/evds_adapter.py` (yeni), `src/services/macro_service.py`, `src/db/repositories/macro.py`, `src/workers/macro_worker.py`, `src/api/routers_macro.py` (takvim ucu hariç), `tests/unit/test_macro_*.py` (takvim testleri hariç) |
| WS6 platform-quality | son iyi kopya deposu, veri kalitesi kontrolleri, `/data/status`, yönetici uçları | `src/services/snapshots.py`, `src/services/quality_service.py`, `src/db/repositories/platform.py`, `src/workers/quality_worker.py`, `src/api/routers_data.py`, `src/api/app.py` (yalnızca include satırı), `tests/unit/test_quality_*.py`, `test_data_status*.py` |

Dondurulmuş (bu branch'te kimse dokunmaz): `dashboard/**`, `src/adapters/kap.py`,
`src/adapters/news.py`, `src/adapters/llm.py`, `src/adapters/screener_adapter.py`,
`src/adapters/scanner_adapter.py`, `src/adapters/search_adapter.py`, `src/adapters/economic_calendar.py`,
`src/services/news_service.py`, `src/services/notification_service.py`, `src/workers/polling_worker.py`,
`src/workers/run_workers.py`, `src/workers/news_worker.py`, `src/core/enums.py`, `src/db/models.py`
(bkz. §3 istisnası), `alembic/versions/0xx` mevcut dosyalar, `src/api/limiter.py`, `middleware.py`,
`dependencies.py`.

## 6. Tamamlanma ölçütü (her WS)

1. Depo dolduran worker döngüsü + `run_<alan>_once` çalışıyor; gerçek veriyle en az bir
   tam tur yerel `hisse_analizi_datainfra` veritabanına yazıldı (worktree `.env` buna bağlı).
2. İlgili API uçları depo öncelikli çalışıyor; sağlayıcı kapalıyken (`monkeypatch` ile)
   `stale` kopya dönüyor; yanıt şekli eskisiyle uyumlu (+`meta`).
3. Doğruluk: en az iki bağımsız kaynakla çapraz karşılaştırma yapıldı ve rapora yazıldı
   (ör. TV kapanış vs İşY `HGDG_KAPANIS`; KAP toplam varlık vs İşY; TCMB tablosu vs EVDS).
4. Testler: yeni birim testleri + gerekiyorsa `pg_session` testleri; tüm kontroller yeşil.
5. Rapor: ne değişti, hangi kaynak neden seçildi, ölçülen sapmalar, açık riskler,
   "İSTEK:" satırları (başka dosyalarda gereken değişiklikler), WS0'ın kablolaması gereken
   worker döngüsü adı ve önerilen zamanlama.

## 7. Operasyon (WS6 platform-quality)

Bu bölüm `src/services/quality_service.py`, `src/services/snapshots.py`,
`src/workers/quality_worker.py`, `src/api/routers_data.py` ve `src/schemas/data.py`
tarafından uygulanır (dosya sahipliği: §5 tablosu). Kaynak: ilgili worker modülleri,
2026-09-23 itibarıyla.

### 7.1 İş (job) takvimi

| Döngü | Modül | İş adı | Zamanlama (Europe/Istanbul) |
|---|---|---|---|
| `reference_loop` | `src/workers/reference_worker.py` | `universe.sync` | Günde bir, `REFERENCE_UNIVERSE_SYNC_TIME` (vars. 07:30); worker başlarken son başarılı çalışma `REFERENCE_UNIVERSE_STALE_HOURS` (vars. 20 sa) içinde değilse hemen. |
| | | `reference.company` | `REFERENCE_TICK_SECONDS` (vars. 900 sn) her tikte `REFERENCE_BATCH_SIZE` (vars. 2) çekirdek şirket; her şirket en çok `REFERENCE_COMPANY_REFRESH_DAYS` (vars. 7) günde bir. |
| `market_loop` | `src/workers/market_worker.py` | `market.quotes` | Seans penceresinde (`MARKET_SESSION_OPEN`–`MARKET_SESSION_CLOSE`, vars. 09:55–18:20) `MARKET_QUOTE_INTERVAL_SECONDS` (vars. 60 sn) aralıkla; seans dışında beklemede. |
| | | `market.bars.daily` | Günde bir, `MARKET_DAILY_BARS_AFTER`'dan (vars. 18:40) sonra ilk uygun tik (≤5 dk gecikme). |
| | | `market.bars.reconcile` | `MARKET_RECONCILE_AFTER`'dan (vars. 20:00) sonra günde bir (+ başlangıçta telafi): İşY `HG_KAPANIS` ile kapanış mutabakatı, `turnover` (`HG_HACIM`) / `vwap` doldurma, lot sayısı `HG_HACIM/HG_AOF` ile uyuşmuyorsa OneEndeks'ten yeniden okuma, İşY yedeğiyle boşluk kapatma. |
| | | `market.accuracy` | Mutabakatla birlikte: PD/DD (`market.pb_field`), pay adedi vs ödenmiş sermaye (`market.shares_vs_paid_in`), lot/TL hacim vs OneEndeks (`market.volume_vs_oneendeks`) kontrol satırları. |
| | | `market.bars.reconcile.backfill` | Tek seferlik, kademeli: fiyat geçmişi tamamlanınca sembol başına ≤1.100 günlük pencerelerle (3 paralel, 0,5–1 sn ara) `turnover`/`vwap` geçmişi İşY'den doldurulur; ilerleme `data_snapshots` `market.history:*` işaretlerinde, yeniden başlatmada kaldığı yerden sürer (çekirdek 100 sembol: 484 sn). |
| | | `market.bars.backfill` | Arka plan döngüsü: başlangıçtan 60 sn sonra, iş kaldıkça 30 sn arayla tur başına ≤40 sembol / 300 sn; tüm evren kapsanınca `MARKET_BACKFILL_IDLE_SECONDS` (vars. 3600 sn) aralıkla eksik geçmişi tarar (çekirdek 5 yıl, evren 2 yıl, TradingView websocket ~3 sn/sembol). |
| `fundamentals_loop` | `src/workers/fundamentals_worker.py` | `fundamentals.statements` | `FUNDAMENTALS_LOOP_INTERVAL_SECONDS` (vars. 600 sn) her tikte `FUNDAMENTALS_BATCH_SIZE` (vars. 12) şirket (KAP WAF nedeniyle şirket başına ≥3 sn). |
| | | `fundamentals.ratios` | Günde bir, `FUNDAMENTALS_RATIOS_HOUR`'dan (vars. 19) sonra ilk tik, o gün için tekrar edilmez. |
| `macro_loop` | `src/workers/macro_worker.py` | `macro.rates` | Günde iki kez, 10:00 ve 14:30 (MPC kararları ~14:00 açıklanır). |
| | | `macro.inflation` | TÜİK yayın penceresinde (ayın 3-5. günü) saatte bir (xx:05, 10:00-18:00); diğer günler yalnızca 10:05. |
| | | `macro.fx` | 15:35; günün bülteni depoda yoksa saatte bir yeniden dener, 23:00'te o gün için vazgeçer. |
| `quality_loop` | `src/workers/quality_worker.py` | `quality.daily` | Günde bir, `QUALITY_DAILY_RUN_TIME` (vars. 19:30 — günlük barlar/oranlar/FX bülteni oturduktan sonra); worker başlarken son başarılı çalışma `QUALITY_STALE_RUN_HOURS`'tan (vars. 24 sa) eskiyse hemen. Kontrollerin ardından bakım (aşağıda §7.4) çalışır. |

`quality.daily` dışındaki tüm işler ilgili WS'nin kendi raporunda daha ayrıntılı
belgelenir; burada yalnızca `/data/status`'un okuduğu zamanlamalar özetlenmiştir.

### 7.2 Kalite kontrol kataloğu (`quality_service.CHECK_NAMES`)

`run_quality_checks(session, names=None)` — `names` boşsa hepsi çalışır. Her kontrol
`{check_name, subject, status, expected, actual, deviation, details}` döndürür ve
(çapraz kaynak/`macro` hariç — o kendi satırını zaten yazar) bir `data_quality_checks`
satırı olarak saklanır.

| `check_name` | `subject` | Eşik / kural | `status` |
|---|---|---|---|
| `freshness.quotes` | `quotes` | Seans içi: `QUALITY_QUOTES_SESSION_WARN_MINUTES`/`_FAIL_MINUTES` (vars. 20/60 dk); seans dışı: `..._OFFSESSION_WARN_HOURS`/`_FAIL_HOURS` (vars. 48/120 sa) | fail (veri yok) / warn / fail / pass |
| `freshness.price_bars` | `price_bars` | Son bar tarihi vs beklenen işlem günü (`now_istanbul`+`is_session_final`, hafta sonu/tatil farkındalı); bir önceki hafta içi güne kadar tolerans | pass / warn (1 gün geride) / fail |
| `freshness.financial_statements` | `financial_statements` | `tracking_tier=core` şirketlerin son 400 gün içinde ≥1 tablosu olma oranı; `QUALITY_FUNDAMENTALS_COVERAGE_WARN_PCT`/`_FAIL_PCT` (vars. 80/50) | pass / warn / fail |
| `freshness.macro_series` | her `series_code` (`tcmb.policy_rate`, `tcmb.overnight.*`, `tcmb.late_liquidity.*`, `tuik.cpi.*`, `tuik.ppi.*`, + görülen diğerleri) | `tcmb.*` (karar güdümlü; PPK faizi değiştirmediği sürece yeni gözlem gelmez): son başarılı `macro.rates` çekiminin yaşı ≤2 gün pass, ≤7 gün warn, sonrası fail; `tcmb.late_liquidity.borrowing` yapısal olarak kullanılmıyor (2010'dan beri 0/`-`), yalnızca not düşülür. `tuik.*` (gözlem ayın 1'i, yayın ~5 hafta sonra): ≤70 gün pass, ≤140 gün warn, sonrası fail (bilinmeyen seri: `QUALITY_MACRO_CADENCE_DEFAULT_DAYS`, vars. 45; 2×'de fail) | pass / warn / fail |
| `freshness.fx_bulletins` | `fx_bulletins` | Son bülten tarihi vs son TCMB iş günü; bir iş günü toleranslı | pass / warn / fail |
| `ingestion.health` | her bilinen iş adı (`quality_service.KNOWN_JOBS`) | Son 24 sa içinde `status='failed'` → warn; son çalışma `QUALITY_INGESTION_DEFAULT_INTERVAL_HOURS`'un (vars. 24 sa) 2 katından eski → fail; hiç çalışmamış → warn | pass / warn / fail |
| `integrity.price_bars` | `price_bars` | `high<low`, `close∉[low,high]`, `close≤0` satır sayısı; `QUALITY_INTEGRITY_FAIL_THRESHOLD`'u (vars. 5) aşarsa fail | pass / warn / fail |
| `integrity.quotes` | `quotes` | `last≤0` satır sayısı; aynı eşik | pass / warn / fail |
| `integrity.stale_active_companies` | `companies` | `is_active` hisse şirketlerden `QUALITY_STALE_ACTIVE_COMPANY_DAYS` (vars. 3) gündür kotasyonu olmayanların sayısı | pass / warn |
| `fundamentals.*` (WS3 kendi yazar: `kap_vs_isy.*`, `pe_vs_tradingview`, `pb_vs_tradingview`, `ttm_vs_tradingview`, `derived_quarter_negative`, `shares_vs_paid_in`) | şirket | `fundamentals_service` doğruluk fonksiyonu, `fundamentals.ratios` işiyle günde bir; F/K vs TV `price_earnings_ttm` ≤%5 pass / ≤%10 warn / üstü fail; PD/DD vs TV `price_book_fq`; TTM hasılat/ana ortaklık net kârı vs TV `total_revenue_ttm`/`net_income_ttm` ≤%2 / ≤%5 / üstü (TV'nin dönemi geride ise yalnızca warn); türetilmiş çeyrekte negatif hasılat fail, negatif FAVÖK warn. Satırlar (check_name, subject, gün) başına tek tutulur. | pass / warn / fail |
| `market.*`, `reference.*`, `macro.*` (ilgili WS kendi yazar) | sembol/şirket/seri | Kapanış TV vs İşY `HG_KAPANIS` ve Yahoo, hacim birimleri, kotasyon vs OneEndeks, göç eden barlar; XU100 üyeliği, ISIN, halka açıklık; TCMB vs borsapy, USD/TRY bülteni vs TV | pass / warn / fail |
| `cross_source.macro` | (WS4'ün kendi `subject`'i) | `src.services.macro_service.run_accuracy_checks` içe aktarılabiliyorsa çalıştırılır (kendi satırlarını kendi yazar); değilse/hata verirse warn | WS4'e bağlı / warn |
| `cross_source.price_tv_vs_isyatirim` | rastgele `QUALITY_PRICE_CROSSCHECK_SYMBOLS` (vars. 5) çekirdek sembol | TradingView kapanışı (`price_bars`) vs İşY `HG_KAPANIS` (işlem gördüğü fiyat; `HGDG_*` temettü düzeltmeli olduğu için kullanılmaz), son `QUALITY_PRICE_CROSSCHECK_BARS` (vars. 10) bar; `QUALITY_PRICE_CROSSCHECK_WARN_PCT`/`_FAIL_PCT` (vars. 2/5); `_TIMEOUT_SECONDS` (vars. 20 sn), ağ hatası → warn | pass / warn / fail |

Not: `HGDG_KAPANIS` temettü + sermaye artışına göre düzeltilir, `price_bars.close`
(TradingView) yalnızca bölünme/bedelsize göre — son kurumsal aksiyon çevresinde fark
*beklenir*; bu yüzden eşikler gevşek tutulmuştur (bkz. §2).

### 7.3 Uçlar

* `GET /data/status` — alan başına (`universe`, `market`, `fundamentals`, `macro`,
  `quality`) son `ingestion_runs` (iş listesi), tablo satır sayıları + en güncel veri
  tarihleri, `freshness` (`fresh|stale|empty`) ve genel `status` (`ok|degraded|down`);
  ayrıca eski `polling_state` satırları. Tamamen toplu SQL (tablo başına tek
  `COUNT`/`MAX`, tek sorguda birleşik) — boş veritabanında bile hata vermez, <1 sn.
  `status`/`freshness` eşikleri buradaki kontrol kataloğundan **bağımsız**, daha geniş
  ve sabit tutulmuştur (§7.2 asıl uyarı kaynağıdır; `/data/status` hızlı özet
  amaçlıdır — ağ gerektiren kontrolleri hiç çalıştırmaz).
* `GET /data/quality?status=&check=&limit=` — her `(check_name, subject)` çifti için
  en son sonuç (`DISTINCT ON`), en yeni önce; `status` (`pass|warn|fail`) ve `check`
  (tam `check_name`) ile filtrelenebilir.
* `GET /data/quality/history?check=&subject=&days=&limit=` — zaman serisi (vars. son
  30 gün).
* `POST /admin/data/quality/run` (`X-Admin-Key` + yönetici hız sınırı) — gövde
  `{"names": [...]}` (boşsa hepsi); kontrolleri hemen çalıştırır, `{"summary", "results"}`
  döner. Bilinmeyen `names` → 400.
* `POST /admin/data/refresh` (aynı koruma) — gövde
  `{"domain": "market|fundamentals|reference|macro", "tickers": [...], "jobs": [...]}`;
  ilgili `run_<domain>_once`'u `QUALITY_REFRESH_TIMEOUT_SECONDS` (vars. 120 sn) içinde
  çalıştırır. `tickers`/`jobs` yalnızca hedef fonksiyonun kabul ettiği parametreler
  eşleniyorsa gönderilir (`tickers`→`symbols` eşlemesi `market` için otomatik).
  Bilinmeyen `domain` → 404 (Türkçe mesaj); modül içe aktarılamıyorsa → 503.

### 7.4 Saklama (retention) ve bakım

Her `quality.daily` çalışmasının sonunda (en iyi çaba, kontrolleri başarısız kılmaz):

* `data_snapshots`: `expires_at`'i `QUALITY_SNAPSHOT_PURGE_GRACE_DAYS`'ten (vars. 14
  gün) daha eski satırlar silinir (`expires_at`'i geçmiş ama bu süre içindeki kopyalar
  `stale=true` ile servis edilmeye devam eder — bkz. §4.1).
* `data_quality_checks`: `QUALITY_RETENTION_DAYS`'ten (vars. 90 gün) eski satırlar silinir.
* `ingestion_runs`: `QUALITY_INGESTION_RETENTION_DAYS`'ten (vars. 30 gün) eski satırlar silinir.

### 7.5 Eklenen ayarlar

Tüm `QUALITY_*` ayarları `src/core/config.py` + `.env.example`'da eklemeli olarak
tanımlıdır (varsayılanlar §7.2-§7.4'te anıldı); tam liste: `QUALITY_WORKER_ENABLED`,
`QUALITY_DAILY_RUN_TIME`, `QUALITY_STALE_RUN_HOURS`, `QUALITY_RETENTION_DAYS`,
`QUALITY_INGESTION_RETENTION_DAYS`, `QUALITY_SNAPSHOT_PURGE_GRACE_DAYS`,
`QUALITY_REFRESH_TIMEOUT_SECONDS`, `QUALITY_QUOTES_SESSION_WARN_MINUTES`,
`QUALITY_QUOTES_SESSION_FAIL_MINUTES`, `QUALITY_QUOTES_OFFSESSION_WARN_HOURS`,
`QUALITY_QUOTES_OFFSESSION_FAIL_HOURS`, `QUALITY_FUNDAMENTALS_COVERAGE_WARN_PCT`,
`QUALITY_FUNDAMENTALS_COVERAGE_FAIL_PCT`, `QUALITY_MACRO_CADENCE_DEFAULT_DAYS`,
`QUALITY_INGESTION_DEFAULT_INTERVAL_HOURS`, `QUALITY_INTEGRITY_FAIL_THRESHOLD`,
`QUALITY_STALE_ACTIVE_COMPANY_DAYS`, `QUALITY_PRICE_CROSSCHECK_SYMBOLS`,
`QUALITY_PRICE_CROSSCHECK_BARS`, `QUALITY_PRICE_CROSSCHECK_WARN_PCT`,
`QUALITY_PRICE_CROSSCHECK_FAIL_PCT`, `QUALITY_PRICE_CROSSCHECK_TIMEOUT_SECONDS`.

## 8. Birleştirme notları (data-infra → master)

Branch, 22.09.2026 gecesi master'ın **commitlenmemiş** çalışma ağacının anlık görüntüsünden (`2080f8b`)
dallandı; master'daki çalışma o tarihten beri commitlenmeden sürdü. Sıra:

1. Master'daki çalışma ağacı commitlenir (v1.0.0; dashboard, KAP akışı, migration `010_event_kap_feed`,
   `011_drop_ai_usage_and_news_labels` vb.).
2. `alembic/versions/020_data_platform.py` içinde `down_revision = "009"` → master'daki son migration yapılır
   (25.09 itibarıyla `"011"`; 010 KAP olay akışı, 011 AI kullanım tablosu ve haber etiketlerinin kaldırılması;
   020 ikisinden de bağımsızdır, yalnızca zincir doğrusal kalmalı). 020'nin `ai_usage` tablosuna ya da
   `news_items.sentiment/impact/rationale` kolonlarına dokunmadığı doğrulanır. Ardından `alembic check` ve
   `upgrade → downgrade base → upgrade` gidiş-dönüşü yeniden koşulur.
3. Birleştirme tabanı **`2080f8b`** olmalıdır (master'ın v1.0.0 commit'i `fb9ef2b` üzerine atılırsa git
   `fb9ef2b`'yi taban seçer ve 22.09 anlık görüntüsündeki her dosya sahte çakışma verir):
   `git merge-tree --write-tree --merge-base=2080f8b master data-infra` ile ağaç üretilir, çakışmalar
   aşağıdaki kurallarla çözülür, commit iki ebeveynle (`master`, `data-infra`) oluşturulur. Beklenen
   çakışmalar ve kural:
   - **AI özetinin/etiketlemesinin kaldırılması (25.09, master):** `src/adapters/llm.py`,
     `tests/unit/test_llm_budget.py`, `test_news_classify_breaker.py`, `AIUsage` modeli ve repository'si,
     `NewsItem.sentiment/impact/rationale`, config'teki `AI_*`/`GEMINI_*`/`ANTHROPIC_*` ayarları ve
     pyproject'teki `anthropic`/`google-genai` master'da silindi → **master sürümü**; branch 2080f8b'den beri
     bunlara dokunmadığı için taban 2080f8b iken silmeler temiz uygulanır, geri gelmemelidir
     (`routers_news.py`/`news_service.py` içindeki etiket alanları da master'daki gibi kalkar).
   - `src/adapters/fundamentals.py`: branch'te yalnızca facade (yeniden dışa aktarım); master'daki
     düzeltmeler ilgili `fundamentals_*.py` modülüne taşınır (ör. PD/DD `price_book_fq` düzeltmesi
     `fundamentals_snapshot.py`'de zaten var) → **branch sürümü alınır**. Aynı şekilde
     `src/adapters/financial_adapter.py`: master'daki `_growth` koruması (`previous <= 0 → None`)
     branch'te oran matematiğiyle birlikte `analysis_service.py`'ye taşındı → branch sürümü alınır.
   - `src/db/models.py`: KAP oturumunun `NormalizedEvent`/`RawEvent` kolonları master'dan, diğer tüm
     modeller branch'ten; `src/db/repository.py`: olay sorguları master'dan, `CompanyRepository.get_all(tier=...)`,
     `PriceDataRepository`, finansal repository'ler branch'ten; `src/api/routers.py`: `/events*` master'dan,
     `/companies`, `/prices*`, `/financials*` branch'ten; `src/adapters/price.py`, `index_adapter.py`: branch.
   - `src/adapters/macro.py`: master sürümü (ekonomik takvim); depo öncelikli okuma `routers_macro.py` üzerinden
     `macro_service`'e delege edildiği için `macro.py`'de değişiklik gerekmez.
   - `src/api/routers_market.py`: master sürümü (grafik `warmup` parametresi: `MAX_CHART_WARMUP_BARS`,
     `get_index_data(..., warmup=)`, `get_ticker_history(..., warmup=)`); branch bu API'yi depo öncelikli
     yolda destekler (`price.py`, `index_adapter.py`, `market_service.py`). Birleştirme sonrası smoke testine
     `/market/ticker/THYAO/history?period=1y&warmup=250` ve `/market/index/XU100?period=1y&warmup=250` eklenir
     (yanıtta 250 elemanlı `warmup` dizisi beklenir).
   - Master'da silinen test dosyaları (`test_analysis_ratios.py`, `test_fundamentals_ratios.py`,
     `test_market_periods.py`, `test_price_service.py`, `test_technical_endpoints.py`): branch'te yeniden
     yazıldılar ve v2 şemayı test ederler → branch sürümü tutulur.
   - `src/workers/polling_worker.py`: master'daki KAP değişiklikleri + branch'teki `POLL_SOURCES = ("kap",)`.
4. Dashboard: branch `dashboard/` klasörüne dokunmaz. Birleştirme sonrası frontend için gerekli küçük
   eklemeler (başka oturumca master'da hazırlanıyor): `meta` bloğunu gösteren tolerant `DataMeta` bileşeni,
   `parsers.ts` `mergeRatios` için `ttm: basis === "ttm"` işareti, hedef fiyat kartında kaynak etiketi
   (`meta.source` = `hedeffiyat`), `GET /companies` çağrılarının varsayılan çekirdek katmanla uyumlu olması.
5. Veritabanı: production'da `alembic upgrade head` (020 `price_data`'yı `price_bars`'a taşır, v1 finansal
   tablo/oran satırlarını **atar**; `fundamentals_worker` ilk turda çekirdek şirketleri KAP'tan yeniden
   doldurur). Worker'ı başlatınca evren senkronu ve geçmiş bar yüklemesi kendiliğinden başlar
   (tam evren ~35 dk, KAP tabloları çekirdek için ~1 saat, evren için birkaç gün).
6. Geliştirme ortamı: `docker-compose.dev.yml` overlay'i ile kaynaklar bind-mount edilir; Temmuz tarihli
   eski imajla çalışan konteynerler yerine bu overlay veya yerel uvicorn/worker kullanılmalı.
