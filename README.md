# Hisse Analizi Dashboard

BIST hisseleri icin kapsamli analiz platformu: teknik/temel analiz, makro ekonomik veriler, hisse tarama, KAP bildirimleri, fiyat takibi ve bildirim sistemi. **borsapy** kutuphanesi uzerine insa edilmistir.

## Mimari

```
┌─────────────────────────────────────────────────────────────────┐
│                   Worker Proses (ayri proses)                    │
│  ┌──────┐ ┌──────┐ ┌────┐ ┌──────┐ ┌────────────┐              │
│  │ KAP  │ │ News │ │ IR │ │Price │ │ Financials │              │
│  └──┬───┘ └──┬───┘ └─┬──┘ └──┬───┘ └─────┬──────┘              │
│     │   [Advisory Lock]  [Semaphore]       │                    │
└─────┼────────┼───────┼───────┼────────────┼─────────────────────┘
      │        │       │       │            │
      │    [TTL Cache + Shared HTTP Client] │
      │        │       │       │            │
┌─────▼────────▼───────▼───────▼────────────▼─┐
│    Event Service / Price Service /            │
│    Financial Service + AnalysisService        │
│  raw_events → normalized → outbox            │
│  financials → DB → ratio calculation         │
│  [ON CONFLICT upsert] [Content-based hash]   │
└────────────────┬─────────────────────────────┘
                 │
┌────────────────▼─────────────────────────┐
│       Notification Worker                 │
│  outbox → FOR UPDATE SKIP LOCKED →        │
│  rules match → atomic insert → email      │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                FastAPI (REST API) + Guvenlik                      │
├──────────────────────────────────────────────────────────────────┤
│  [Rate Limiter] [CORS Allowlist] [Admin API Key Auth]            │
│  Core:       /health /events /prices /companies                  │
│  Finansal:   /financials?ticker= /financials/ratios?ticker=      │
│  Teknik:     /technical/{ticker}/rsi /macd /bollinger /signals   │
│  Temel:      /fundamentals/{ticker}/info /balance-sheet          │
│  Makro:      /macro/tcmb /inflation /fx/{symbol} /calendar       │
│  Piyasa:     /market/screener /scanner /indices /search /tweets  │
│  Admin:      /admin/poll/run-once /stats  [X-Admin-Key]          │
└──────────────────────────────────────────────────────────────────┘
```

## Ozellikler

### Teknik Analiz
- RSI, MACD, Bollinger Bands, SMA, EMA, SuperTrend, Stochastic
- Teknik sinyal ozeti (AL/SAT/NOTR)
- Tum zaman dilimlerinde sinyal analizi
- Teknik sinyal tarama (scanner)

### Temel Analiz
- Sirket bilgileri ve finansal veriler
- Bilanco, gelir tablosu, nakit akis tablosu (yillik + ceyreklik)
- Temettu gecmisi, ortaklik yapisi
- Analist tavsiyeleri ve hedef fiyatlar
- Kazanc aciklama tarihleri

### Makro Ekonomik Veriler
- TCMB faiz oranlari ve politika faizi
- Enflasyon verileri
- Doviz kurlari (USD/TRY, EUR/TRY, vb.)
- Ekonomik takvim

### Piyasa Verileri
- BIST endeksleri (XU100, XU030, vb.)
- Hisse tarama (screener) — ozel filtrelerle (F/K, ROE, vb.)
- Teknik sinyal tarama (scanner)
- 780+ BIST sirketi arama
- Twitter/X finansal tweet'ler
- Anlik fiyat snapshot (coklu sembol)

### Olay & Bildirim Sistemi
- KAP bildirimleri (borsapy + KAP API yedek)
- Kurumsal haberler ve yatirimci iliskileri
- Fiyat verisi takibi (borsapy + yfinance yedek)
- E-posta bildirim sistemi (outbox pattern, idempotent)

### Guvenlik & Production Hardening (v0.5.0)
- Admin API Key authentication (X-Admin-Key header)
- Config-driven CORS allowlist
- API rate limiting (slowapi)
- PostgreSQL ON CONFLICT upsert (race-safe dedup)
- Outbox claim: SELECT...FOR UPDATE SKIP LOCKED
- Notification idempotency (DB unique constraint)
- CRLF injection prevention (email headers)
- UTC-aware timestamps (merkezi utcnow)
- Content-based financial hashing
- Worker proses izolasyonu (API'den bagimsiz)
- TTL in-memory caching (adapter sonuclari)
- Production config validation (fail-fast)

## Veri Kaynaklari

| Kaynak | Birincil | Yedek | Poll Interval |
|--------|----------|-------|---------------|
| KAP Bildirimleri | borsapy | KAP SPA API | 30sn |
| Kurumsal Haberler | httpx + BS4 | - | 60sn |
| Yatirimci Iliskileri | httpx + BS4 | - | 300sn |
| Fiyat Verisi | borsapy | yfinance | 300sn |
| Finansal Tablolar | borsapy | - | 3600sn (polling + DB) |
| Teknik Gostergeler | borsapy | - | on-demand (60s cache) |
| Makro Veriler | borsapy (TCMB) | - | on-demand (600s cache) |
| Endeks/Tarama | borsapy | - | on-demand (120s cache) |

## Kurulum

### Docker ile (onerilen)

```bash
cp .env.example .env
# .env icinde ADMIN_API_KEY, CORS_ORIGINS, DB credentials ayarla

docker-compose up -d
docker-compose exec app alembic upgrade head
docker-compose exec app python scripts/seed.py
```

### Local gelistirme

```bash
# PostgreSQL gerekli (16+)
pip install -e ".[dev]"
cp .env.example .env
# .env icinde DATABASE_URL'i duzenle

alembic upgrade head
python scripts/seed.py
uvicorn src.api.app:app --reload
```

### Ortam Degiskenleri

| Degisken | Aciklama | Zorunlu |
|----------|----------|---------|
| `DATABASE_URL` | PostgreSQL baglanti adresi | Evet |
| `ADMIN_API_KEY` | Admin endpoint auth key | Production'da evet |
| `CORS_ORIGINS` | Izin verilen origin'ler (virgul ayirmali) | Hayir (dev: *) |
| `RATE_LIMIT_PER_MINUTE` | API rate limit | Hayir (varsayilan: 100) |
| `WORKER_MAX_CONCURRENCY` | Worker semaphore limiti | Hayir (varsayilan: 5) |
| `WORKER_SINGLE_REPLICA` | Tek worker replica zorunlulugu | Hayir |
| `SMTP_HOST`, `SMTP_PORT` | E-posta sunucusu | Bildirimler icin |

## API Endpoint'leri

### Core
```
GET  /health                              Sistem durumu
GET  /companies                           Sirket listesi
GET  /events?source_code=kap&limit=50     Olay listesi
GET  /events/latest                       Son 10 olay
GET  /prices?ticker=THYAO                 Fiyat gecmisi
GET  /prices/latest?ticker=THYAO          Son fiyat
GET  /financials?ticker=THYAO             Finansal tablolar (DB)
GET  /financials/ratios?ticker=THYAO      Hesaplanmis oranlar (DB)
```

### Teknik Analiz
```
GET  /technical/{ticker}/rsi?period=14    RSI gostergesi
GET  /technical/{ticker}/macd             MACD
GET  /technical/{ticker}/bollinger        Bollinger Bands
GET  /technical/{ticker}/sma?period=20    SMA
GET  /technical/{ticker}/ema?period=20    EMA
GET  /technical/{ticker}/supertrend       SuperTrend
GET  /technical/{ticker}/stochastic       Stochastic
GET  /technical/{ticker}/signals          Teknik sinyal ozeti
GET  /technical/{ticker}/signals/all-timeframes  Tum zaman dilimleri
```

### Temel Analiz
```
GET  /fundamentals/{ticker}/info          Sirket bilgileri
GET  /fundamentals/{ticker}/fast-info     Hizli ozet
GET  /fundamentals/{ticker}/balance-sheet?quarterly=false  Bilanco
GET  /fundamentals/{ticker}/income-statement  Gelir tablosu
GET  /fundamentals/{ticker}/cashflow      Nakit akis
GET  /fundamentals/{ticker}/dividends     Temettu gecmisi
GET  /fundamentals/{ticker}/holders       Buyuk ortaklar
GET  /fundamentals/{ticker}/recommendations  Analist tavsiyeleri
GET  /fundamentals/{ticker}/price-targets Hedef fiyatlar
GET  /fundamentals/{ticker}/earnings-dates  Kazanc tarihleri
```

### Makro Ekonomi
```
GET  /macro/tcmb                          TCMB faiz oranlari
GET  /macro/policy-rate                   Politika faizi
GET  /macro/inflation                     Enflasyon verileri
GET  /macro/fx/{symbol}                   Doviz kuru (USDTRY, EURTRY)
GET  /macro/calendar                      Ekonomik takvim
```

### Piyasa Verileri
```
GET  /market/screener                     Hisse tarama (varsayilan)
POST /market/screener                     Hisse tarama (ozel filtre)
GET  /market/screener/templates           Tarama sablonlari
GET  /market/scanner?condition=rsi_oversold  Teknik sinyal tarama
GET  /market/indices                      Tum BIST endeksleri
GET  /market/index/{symbol}?period=1ay    Endeks fiyat verisi
GET  /market/index/{symbol}/info          Endeks bilgileri
GET  /market/search?q=THYAO              Sembol arama
GET  /market/companies/all                Tum BIST sirketleri
GET  /market/tweets/{ticker}              Hisse tweet'leri
GET  /market/snapshot?symbols=THYAO,GARAN Anlik fiyat snapshot
```

### Admin (X-Admin-Key gerekli)
```
POST /admin/poll/run-once                 Manuel poll
POST /admin/backfill                      Gecmis veri cekme
POST /admin/notification-rules            Bildirim kurali ekle
POST /admin/notifications/test-send       Test bildirim
GET  /admin/stats                         Istatistikler
```

## Test

```bash
pytest tests/unit/ -v              # Unit testler (49+)
pytest tests/integration/ -v       # Integration testler
pytest -v                          # Tumu
```

## Bilinen Limitler

1. **borsapy** 3rd party — aktif ama kirilabilir. Yedek kaynaklar mevcut.
2. **KAP SPA API** resmi degil — habersiz degisebilir.
3. **KAP** 30sn'den sik poll'lanmamali.
4. Sistem **hukuki/finansal tavsiye araci degildir**.
5. **yfinance** kisisel kullanim icindir — Yahoo TOS kontrol edin.

## Teknoloji Stack'i

| Kategori | Teknoloji |
|----------|-----------|
| Runtime | Python 3.11+ |
| Web Framework | FastAPI (async) |
| ORM | SQLAlchemy 2.x (async) |
| DB | PostgreSQL 16 |
| Veri Kaynagi | borsapy 0.8.3 (MIT) |
| Yedek Fiyat | yfinance |
| HTTP Client | httpx (async, shared pool) |
| Rate Limiting | slowapi |
| Logging | structlog (JSON) |
| Cache | TTL in-memory (src/adapters/utils.py) |
| Container | Docker + Compose |
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui |
