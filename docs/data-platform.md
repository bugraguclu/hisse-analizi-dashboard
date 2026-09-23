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
| İş Yatırım günlük geçmiş | `GET .../Common/Data.aspx/HisseTekil?hisse=GARAN&startdate=15-09-2026&enddate=22-09-2026` | 0,1 sn; resmî günlük seri: `HGDG_KAPANIS` (kapanış), `HGDG_AOF` (AOF/VWAP), `HGDG_MIN/MAX`, `HGDG_HACIM` (TL ciro), `PD` (piyasa değeri), `HAO_PD` (halka açık PD), `DOLAR_BAZLI_FIYAT`, `END_DEGER` (aynı gün XU100). `HG_*` alanları da var — hangisinin düzeltilmiş olduğu WS2 tarafından doğrulanacak. |
| İş Yatırım kotasyon | `GET .../Common/Data.aspx/OneEndeks?endeks=GARAN` (borsapy `get_realtime_quote`, deprecated ama çalışıyor) | 0,1 sn; `last, open, high, low, close(=önceki kapanış), volume(TL), quantity(lot), bid, ask, week/month/year close, updateDate`. TV ile birebir. Çapraz kontrol ve yedek kaynak olarak ideal. |
| İş Yatırım MaliTablo | `src/adapters/financial_adapter.fetch_isyatirim_financials` | 4 dönem/istek; IAS 29 uygulayan şirketlerde yıl sonu kolonları yeniden ifade edilir (`restatement_factor` ile KAP'a çevrilir); bankalarda solo (konsolide değil). |
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
| `financial_statements` | (company_id, source, period, statement_type) | WS3 | `source ∈ {kap, isyatirim}`, `period = "YYYY/MM"`, `statement_type ∈ {balance_sheet, income_stmt, cash_flow}`, `items_json` = sıralı satırlar `{code, label, key, value}` (TL). `restated` + `restatement_factor` İşY IAS 29 kolonları için. |
| `financial_facts` | (company_id, period) | WS3 | Kanonik kalemler (FLOW_KEYS + STOCK_KEYS), **ilk açıklanan (KAP) bazında**; akımlar mali yıl başından kümülatif, `months` ile. |
| `financial_ratios` | (company_id, period, basis) | WS3 | `basis ∈ {ttm, annual}`; 15 oran + `market_cap/price/shares_outstanding/shares_source`, `ttm_quarters`, `inputs_json` (denetim izi). |
| `dividends`, `capital_increases`, `shareholders`, `analyst_targets`, `expected_disclosures` | bkz. model | WS1 | Şirket başına yenilemede `shareholders` tamamen değiştirilir; diğerleri upsert. |
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
