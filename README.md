# Hisse Analizi Dashboard

BIST hisseleri icin kapsamli analiz platformu: teknik/temel analiz, makro ekonomik veriler, hisse tarama, KAP bildirimleri, fiyat takibi ve bildirim sistemi. **borsapy** kutuphanesi uzerine insa edilmistir.

## Mimari

```
┌─────────────────────────────────────────────────────────────────┐
│                      Polling Worker                              │
│  ┌──────┐ ┌──────┐ ┌────┐ ┌──────┐                             │
│  │ KAP  │ │ News │ │ IR │ │Price │                             │
│  └──┬───┘ └──┬───┘ └─┬──┘ └──┬───┘                             │
└─────┼────────┼───────┼───────┼───────────────────────────────────┘
      │        │       │       │
┌─────▼────────▼───────▼───────▼──────────┐
│         Event Service                     │
│  raw_events → normalized → outbox         │
└────────────────┬─────────────────────────┘
                 │
┌────────────────▼─────────────────────────┐
│       Notification Worker                 │
│  outbox → rules match → email             │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                      FastAPI (REST API)                           │
├──────────────────────────────────────────────────────────────────┤
│  Core:     /health /events /prices /companies                    │
│  Teknik:   /technical/{ticker}/rsi /macd /bollinger /signals     │
│  Temel:    /fundamentals/{ticker}/info /balance-sheet /dividends │
│  Makro:    /macro/tcmb /inflation /fx/{symbol} /calendar         │
│  Piyasa:   /market/screener /scanner /indices /search /tweets    │
│  Admin:    /admin/poll/run-once /stats                           │
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
- E-posta bildirim sistemi (outbox pattern)

## Veri Kaynaklari

| Kaynak | Birincil | Yedek | Poll Interval |
|--------|----------|-------|---------------|
| KAP Bildirimleri | borsapy | KAP SPA API | 30sn |
| Kurumsal Haberler | httpx + BS4 | - | 60sn |
| Yatirimci Iliskileri | httpx + BS4 | - | 300sn |
| Fiyat Verisi | borsapy | yfinance | 300sn |
| Teknik Gostergeler | borsapy | - | on-demand |
| Finansal Tablolar | borsapy | - | on-demand |
| Makro Veriler | borsapy (TCMB) | - | on-demand |
| Endeks/Tarama | borsapy | - | on-demand |

## Kurulum

### Docker ile (onerilen)

```bash
cp .env.example .env
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

## API Endpoint'leri

### Core
```
GET  /health                              Sistem durumu
GET  /companies                           Sirket listesi
GET  /events?source_code=kap&limit=50     Olay listesi
GET  /events/latest                       Son 10 olay
GET  /prices?ticker=AEFES                 Fiyat gecmisi
GET  /prices/latest?ticker=AEFES          Son fiyat
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
GET  /market/search?q=THYAO               Sembol arama
GET  /market/companies/all                Tum BIST sirketleri
GET  /market/tweets/{ticker}              Hisse tweet'leri
GET  /market/snapshot?symbols=AEFES,THYAO Anlik fiyat snapshot
```

### Admin
```
POST /admin/poll/run-once                 Manuel poll
POST /admin/backfill                      Gecmis veri cekme
POST /admin/notification-rules            Bildirim kurali ekle
POST /admin/notifications/test-send       Test bildirim
GET  /admin/stats                         Istatistikler
```

## Test

```bash
pytest tests/unit/ -v              # Unit testler
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
| HTTP Client | httpx (async) |
| Logging | structlog (JSON) |
| Container | Docker + Compose |
