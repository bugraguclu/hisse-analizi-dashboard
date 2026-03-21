# Sistem Mimarisi — Hisse Analizi Dashboard

## Genel Bakis

BIST 780+ hissesini takip eden, haberleri toplayan, finansal verileri analiz eden
ve bildirimler gonderen bir **full-stack platform**. Backend Python/FastAPI,
frontend Next.js 14, veritabani PostgreSQL 16.

```
┌─────────────────────────────────────────────────────┐
│                    KULLANICI                          │
│      (Next.js Dashboard / Tarayici / API Client)     │
└────────────────────────┬────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────┐
│              FastAPI (API Katmani)                    │
│                                                      │
│  [Rate Limiter]  [CORS Allowlist]  [Admin Auth]      │
│                                                      │
│  routers.py  → Core + Admin + Teknik + Temel +       │
│                Makro + Piyasa endpoint'leri           │
│  dependencies.py → X-Admin-Key auth middleware        │
└────────────┬───────────────────────┬────────────────┘
             │                       │
┌────────────▼──────────┐ ┌─────────▼────────────────┐
│  Services (Is Mantigi)│ │  Workers (Ayri Proses)    │
│                       │ │                           │
│  event_service.py     │ │  polling_worker.py        │
│  (veri isleme,        │ │  (advisory lock,          │
│   dedup, normalize)   │ │   semaphore concurrency)  │
│                       │ │                           │
│  notification_svc.py  │ │  run_workers.py           │
│  (idempotent send,    │ │  (API'den bagimsiz)       │
│   CRLF sanitize)      │ │                           │
│                       │ │                           │
│  analysis_service.py  │ │                           │
│  (finansal oran)      │ │                           │
└────────────┬──────────┘ └─────────┬─────────────────┘
             │                       │
┌────────────▼───────────────────────▼────────────────┐
│              Adapters (Veri Kaynaklari)               │
│                                                      │
│  kap.py         → KAP bildirimleri (borsapy + API)   │
│  price.py       → Fiyat verisi (borsapy + yfinance)  │
│  financial_adapter.py → Bilanco, gelir tablosu        │
│  macro.py       → TCMB, enflasyon, doviz, takvim     │
│  technical.py   → RSI, MACD, Bollinger, SMA, EMA     │
│  fundamentals.py → Sirket bilgileri, temettu          │
│  screener_adapter.py → Hisse tarama                   │
│  scanner_adapter.py  → Teknik sinyal tarama           │
│  index_adapter.py    → BIST endeksleri                │
│                                                      │
│  utils.py → TTLCache, cached(), shared HTTP client,  │
│             run_sync(), df_to_records()               │
└────────────┬────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────┐
│              PostgreSQL (Veritabani)                  │
│                                                      │
│  companies          → 780+ BIST sirketi              │
│  sources            → Veri kaynaklari (KAP, fiyat)   │
│  raw_events         → Ham veriler                    │
│  normalized_events  → Islenmis veriler               │
│  price_data         → Fiyat gecmisi                  │
│  financial_stmts    → Bilanco, gelir, nakit akisi    │
│  financial_ratios   → ROE, ROA, margin hesaplamalari │
│  outbox_entries     → Bildirim kuyrugu               │
│  notifications      → Gonderilen bildirimler         │
│  notification_rules → Bildirim kurallari             │
│  polling_states     → Polling durumu                 │
│                                                      │
│  Ozellikler:                                         │
│  - ON CONFLICT upsert (atomic dedup)                 │
│  - FOR UPDATE SKIP LOCKED (outbox claim)             │
│  - Advisory locks (polling koordinasyonu)            │
│  - Unique constraint (notification idempotency)      │
│  - pool_pre_ping + pool_recycle (baglanti sagligi)   │
└─────────────────────────────────────────────────────┘
```

---

## Klasor Yapisi

```
hisse-analizi-dashboard/
├── docs/                    <- Dokumantasyon
│   ├── mimari.md            <- Sistem mimarisi (bu dosya)
│   ├── api-rehberi.md       <- API kullanim kilavuzu
│   ├── yol-haritasi.md      <- Proje yol haritasi
│   └── katki-rehberi.md     <- Katki ve calisma kurallari
│
├── src/                     <- Python backend
│   ├── adapters/            <- Dis veri kaynaklarina baglanti
│   │   ├── base.py          <- Temel adapter siniflari (abstract)
│   │   ├── kap.py           <- KAP bildirim cekici
│   │   ├── price.py         <- Fiyat verisi cekici
│   │   ├── financial_adapter.py <- Finansal tablo adapter (content hash)
│   │   ├── fundamentals.py  <- Sirket bilgileri, temettu
│   │   ├── macro.py         <- TCMB, doviz, endeks, takvim
│   │   ├── technical.py     <- RSI, MACD, Bollinger, screener
│   │   ├── screener_adapter.py <- Hisse tarama
│   │   ├── scanner_adapter.py  <- Teknik sinyal tarama
│   │   ├── index_adapter.py    <- BIST endeksleri
│   │   └── utils.py         <- TTLCache, cached(), HTTP client, run_sync()
│   │
│   ├── api/                 <- HTTP endpoint tanimlari
│   │   ├── app.py           <- FastAPI uygulamasi (rate limiter, CORS, lifecycle)
│   │   ├── routers.py       <- Tum endpoint'ler (admin auth korumali)
│   │   └── dependencies.py  <- Admin auth dependency (X-Admin-Key)
│   │
│   ├── core/                <- Ayarlar ve sabitler
│   │   ├── config.py        <- Ortam degiskenleri + production validation
│   │   ├── enums.py         <- Enum tanimlari (SourceKind, Severity vb.)
│   │   ├── logging.py       <- Log ayarlari
│   │   └── time.py          <- Merkezi utcnow() fonksiyonu
│   │
│   ├── db/                  <- Veritabani katmani
│   │   ├── models.py        <- 13 tablo tanimi (unique constraint'ler)
│   │   ├── repository.py    <- ON CONFLICT upsert, FOR UPDATE SKIP LOCKED
│   │   └── session.py       <- DB baglanti yonetimi (pool_pre_ping)
│   │
│   ├── services/            <- Is mantigi
│   │   ├── event_service.py <- Veri isleme, dedup, normalize
│   │   ├── notification_service.py <- Idempotent bildirim, CRLF sanitize
│   │   └── analysis_service.py <- 8 finansal oran hesaplama
│   │
│   ├── workers/             <- Arka plan gorevleri (AYRI PROSES)
│   │   ├── polling_worker.py     <- Advisory lock + semaphore concurrency
│   │   ├── notification_worker.py <- Outbox claim + stuck reclaim
│   │   └── run_workers.py        <- Worker baslangic noktasi
│   │
│   └── schemas/             <- API istek/yanit semalari (Pydantic)
│       └── events.py        <- Event, Price, Financial semalari
│
├── dashboard/               <- Next.js 14 frontend
│   ├── src/app/             <- 7 sayfa (App Router)
│   ├── src/components/      <- UI bilesenleri
│   ├── src/lib/             <- API client, format utils
│   └── Dockerfile           <- Multi-stage production build
│
├── alembic/                 <- DB migration'lari (001 + 002)
├── tests/                   <- Unit + integration (49+ test)
├── scripts/                 <- Seed, backfill, debug
├── docker-compose.yml       <- 4 servis: db, app, worker, dashboard
├── Dockerfile               <- Production build (no -e, no --reload)
├── pyproject.toml           <- Python bagimliliklari
└── .env.example             <- Ortam degiskenleri sablonu
```

---

## Teknoloji Yigini

| Katman | Teknoloji | Ne Ise Yarar |
|--------|-----------|-------------|
| **Backend** | Python 3.11 + FastAPI | API sunucusu |
| **Veritabani** | PostgreSQL 16 | Veri depolama |
| **ORM** | SQLAlchemy 2.0 (async) | Python <-> SQL koprusu |
| **Migration** | Alembic | DB sema degisiklikleri |
| **Veri Kaynagi** | borsapy, yfinance | Borsa verisi cekme |
| **HTTP Client** | httpx (shared pool) | Dis API cagrilari |
| **Rate Limiting** | slowapi | API korumasi |
| **Cache** | TTL in-memory | Adapter sonuc onbellegi |
| **Konteyner** | Docker + Docker Compose | Deployment |
| **Frontend** | Next.js 14, TypeScript, Tailwind | Dashboard arayuzu |

---

## Veri Akisi

```
1. Worker proses baslar (API'den bagimsiz)
   |
2. Her kaynak icin advisory lock alinir
   |
3. Semaphore ile sinirli concurrency (varsayilan: 5)
   |
4. Adapter → borsapy → BIST API'si → ham veri alir
   |   (TTL cache ile tekrar cagrilar onlenir)
   |
5. EventService → veriyi normalize eder
   |   (ON CONFLICT ile atomic dedup)
   |
6. Veritabanina kaydeder (raw_events + normalized_events)
   |
7. EventOutbox'a yazar (bildirim kuyrugu)
   |
8. NotificationWorker → FOR UPDATE SKIP LOCKED ile claim
   |
9. Bildirim kurallarina gore eslestirme
   |
10. Atomic insert (idempotency) → e-posta gonderir
    (CRLF sanitize edilmis subject)
```

---

## Guvenlik Modeli

| Katman | Mekanizma |
|--------|-----------|
| API Auth | X-Admin-Key header (admin endpoint'ler) |
| CORS | Config-driven origin allowlist |
| Rate Limit | slowapi (varsayilan: 100/dk) |
| DB Dedup | ON CONFLICT upsert (race-safe) |
| Outbox | FOR UPDATE SKIP LOCKED (cift islem onleme) |
| Notification | Unique constraint (cift gonderim onleme) |
| Email | CRLF injection sanitization |
| Config | Production'da zorunlu secret validation |
| Timestamps | UTC-aware (merkezi utcnow) |
