# BIST Hisse Analizi Platformu — Proje Ozeti

**Son Guncelleme:** 21 Mart 2026
**Versiyon:** 0.5.0
**Durum:** Production hardening tamamlandi, deployment hazir

---

## Proje Nedir?

BIST'te islem goren 780+ sirket icin kapsamli bir hisse analiz platformu.
Teknik analiz, temel analiz, KAP bildirimleri, makro ekonomik veriler ve
gercek zamanli fiyat takibi tek bir catida sunulur. Backend Python/FastAPI,
frontend Next.js 14 ile gelistirilmistir. Docker Compose ile tek komutla
tum sistem ayaga kalkar.

---

## Proje Gelisim Sureci

### Faz 0 — Proje Baslangici (14 Mart 2026)

Proje "AEFES Listener" adiyla, yalnizca Anadolu Efes (AEFES) hissesini
izleyen bir KAP bildirim takip sistemi olarak basladi.

**Yapilan:**
- FastAPI backend yapisi kuruldu
- PostgreSQL + Docker Compose altyapisi olusturuldu
- KAP bildirimleri ve fiyat verisi cekme (sadece AEFES)
- Bildirim sistemi (outbox pattern ile event-driven mimari)
- Temel API endpoint'leri (health, events, prices, companies)
- 10 veritabani tablosu ve repository katmani
- Polling + notification worker'lari
- 36 unit test

**Teknik kararlar:** Moduler monolit mimari secildi. Event pipeline
(raw → normalize → outbox) sayesinde veri kaynaklari bagimsiz calisir.

### Faz 1 — Multi-Stock Genislemesi (15 Mart 2026)

Proje tek hisseden BIST 30'a genisledi.

**Yapilan:**
- 30 BIST sirketi veritabanina eklendi
- KAP ve fiyat adapter'lari dinamik hale getirildi (hardcoded AEFES kaldirildi)
- Polling worker tum sirketler uzerinde dongulu calismaya basladi
- API endpoint'lerine `?ticker=` filtresi eklendi
- Docker ve Alembic migration duzeltmeleri yapildi

### Faz 2 — borsapy Tam Entegrasyon (15 Mart 2026)

borsapy kutuphanesi (MIT, 780+ BIST sirketi) uzerinden tum veri modulleri
platforma entegre edildi. Sistem sadece KAP takibinden kapsamli bir analiz
platformuna donustu.

**Eklenen moduller:**
- Teknik analiz: RSI, MACD, Bollinger Bands, SMA, EMA, SuperTrend, Stochastic
- Teknik sinyal ozeti: AL/SAT/NOTR kararlari, tum zaman dilimleri
- Temel analiz: sirket bilgileri, bilanco, gelir tablosu, nakit akis, temettu, ortaklik yapisi
- Analist tavsiyeleri ve hedef fiyatlar
- Makro veriler: TCMB politika faizi, enflasyon, doviz kurlari, ekonomik takvim
- Hisse tarama (screener) ve teknik sinyal tarama (scanner)
- BIST endeks verileri, sembol arama
- Twitter/X finansal tweet entegrasyonu
- Canli fiyat stream altyapisi (TradingView WebSocket)
- 4 yeni API router dosyasi, toplam 50+ endpoint

**Sonuc:** 15 adapter sinifi, 53 API endpoint, Swagger dokumantasyonu otomatik.

### Faz 3 — Finansal Analiz ve NLP (20 Mart 2026)

Finansal tablolarin veritabanina kaydedilmesi, otomatik oran hesaplama ve
KAP bildirimlerinin NLP ile siniflandirilmasi eklendi.

**Yapilan:**
- FinancialStatement ve FinancialRatio modelleri (toplam 13 DB tablosu)
- AnalysisService: 8 finansal oran otomatik hesaplama (ROE, ROA, net/gross/EBITDA margin, debt-to-equity, current ratio, net debt/EBITDA)
- NLP keyword siniflandirma: KAP bildirimlerini 7 kategoriye ayirma (temettu, sermaye artirimi, hukuki, yonetim vb.)
- FinancialAdapter: borsapy uzerinden bilanco, gelir tablosu, nakit akis → DB
- Polling worker'a financials source eklendi (saatlik guncelleme)
- Alembic initial migration (13 tablo, tum index ve constraint'ler)
- GET /financials ve GET /financials/ratios endpoint'leri
- Dinamik bildirim subject'i (hardcoded AEFES yerine sirket ticker'i)
- Utility script'ler: backfill_classification, debug_financials
- Developer Test UI v0.3.0 (finansal tablolar bolumu)
- 42 test, 53 endpoint

**Karar:** Backend MVP-hazir ilan edildi. Frontend gelistirmeye gecis karari alindi.

### Faz 4 — Dashboard UI (20 Mart 2026)

Iki asamada gerceklesti: once vanilla JS ile hizli bir prototip, ardindan
Next.js 14 ile profesyonel dashboard.

**Adim 1 — Vanilla JS Prototip:**
- Tek sayfa SPA (hash-based routing), 5 bolum: Overview, Stocks, Detail, Screener, News
- Chart.js entegrasyonu, dark tema
- `src/static/dashboard/` altinda 6 dosya

**Adim 2 — Next.js 14 Dashboard:**
- App Router, TypeScript, Tailwind CSS
- shadcn/ui component library (card, badge, table, tabs, skeleton, sonner)
- React Query (@tanstack/react-query) ile veri yonetimi (30sn cache)
- Recharts ile grafikler (AreaChart, BarChart)
- Lucide React ikon seti
- Light fintech tema (beyaz zemin, teal sidebar, turuncu vurgular)

**7 sayfa:**
1. Dashboard — 6 KPI karti, fiyat snapshot, son olaylar tablosu
2. Olaylar — Source/ticker filtreleme, sayfalama
3. Hisse Detay — 90 gunluk fiyat grafigi, hacim, finansal oranlar, olaylar
4. Teknik Analiz — AL/SAT/NOTR sinyalleri, RSI, MACD, Bollinger, SuperTrend
5. Temel Analiz — Sirket bilgileri, analist tavsiyeleri, hedef fiyat, ortaklar
6. Makro Ekonomi — Politika faizi, enflasyon, doviz, TCMB, ekonomik takvim
7. Tarama — Screener, teknik sinyal scanner, BIST endeksleri

### Faz 4.5 — Proje Genelleme ve Docker (20 Mart 2026)

Proje "AEFES Listener"dan genel "BIST Hisse Analizi Platformu"na donusturuldu.
Dashboard Docker Compose'a eklenerek tek komutla deploy mumkun hale geldi.

**Yapilan:**
- Tum varsayilan ticker AEFES → THYAO olarak degistirildi (25+ dosya, 75 referans)
- DB adi: aefes_listener → hisse_analizi
- DB kullanicisi: aefes → hisse
- User-Agent: AEFESListener/1.0 → HisseAnalizi/1.0
- Dashboard icin multi-stage Dockerfile (Node 20 Alpine, standalone output)
- docker-compose.yml: 4 servis (db, app, worker, dashboard) + opsiyonel mailhog
- next.config.ts: standalone output + backend API rewrite
- Tum dokumantasyon guncellendi

### Faz 5 — Production Hardening (21 Mart 2026)

Sistemin production ortamina hazirlanmasi icin kapsamli guclendirme calismasi.
8 alt fazda 10 kritik mimari risk giderildi.

**Guvenlik:**
- Admin endpoint'leri `X-Admin-Key` header ile korunuyor (dev bypass mevcut)
- CORS origin listesi config-driven (hardcoded `*` kaldirildi)
- slowapi ile API rate limiting (varsayilan: 100/dakika)
- Production config validation — zorunlu secret eksikse fail-fast
- E-posta header CRLF injection onleme

**DB Dogrulugu ve Concurrency:**
- Tum `select-then-insert` → PostgreSQL `ON CONFLICT` atomic upsert
- Outbox: `SELECT...FOR UPDATE SKIP LOCKED` ile yarisma-guvenli claim
- Notification: DB unique constraint + atomic insert ile cift gonderim onleme
- Stuck PROCESSING entry'lerin otomatik geri kazanimi

**Worker ve Performans:**
- Worker API lifespan'den ayrildi (ayri proses)
- PostgreSQL advisory lock ile kaynak bazli polling koordinasyonu
- `asyncio.Semaphore` ile sinirli concurrency
- Paylasimli `httpx.AsyncClient` (connection pooling)
- TTL in-memory cache (30s-600s) — adapter sonuclari icin
- `asyncio.to_thread()` ile modern async pattern

**Frontend Uyumu:**
- TypeScript tipleri backend Pydantic semalarina tam hizalandi
- Severity enum duzeltildi (HIGH/WATCH/INFO)
- Endpoint bazli cache stratejisi

**Temizlik:**
- Dead code silindi: `routers_extended.py`, `models_extended.py`
- `datetime.now()` → merkezi `utcnow()` (UTC-aware)
- Docker: editable install ve --reload kaldirildi, credentials parametrik

**Sonuc:** 44 dosya, +1284/-998 satir, 7 yeni test dosyasi, 49+ test.

---

## Mevcut Mimari

```
Kullanici
   |
   v
[Next.js Dashboard :3000]  <-->  [FastAPI Backend :8000]  <-->  [PostgreSQL :5432]
                                        |                            |
                                   [Rate Limiter]            [Advisory Locks]
                                   [Admin Auth]              [ON CONFLICT Upsert]
                                   [CORS Allowlist]          [FOR UPDATE SKIP LOCKED]
                                        |
                                   [Worker Proses]  (ayri proses, API'den bagimsiz)
                                        |
                                   [borsapy / KAP / TradingView]
                                        |
                                   [TTL Cache] --> [Shared HTTP Client]
```

**Backend:** Python 3.11, FastAPI (async), SQLAlchemy 2.x async, Alembic, slowapi
**Frontend:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, React Query, Recharts
**Veri Kaynagi:** borsapy 0.8.3 (MIT) — KAP, fiyat, teknik, temel, makro
**Guvenlik:** Admin API Key auth, CORS allowlist, rate limiting, CRLF sanitization
**Deploy:** Docker Compose (4 servis), production-hardened

### Endpoint Ozeti

| Grup | Sayi | Ornekler |
|------|------|----------|
| Core | 17 | health, events, prices, companies, admin, financials |
| Teknik Analiz | 9 | RSI, MACD, Bollinger, SMA, EMA, SuperTrend, signals |
| Temel Analiz | 10 | info, balance-sheet, income, cashflow, dividends, holders |
| Makro Ekonomi | 5 | TCMB, enflasyon, doviz, politika faizi, takvim |
| Piyasa | 10 | screener, scanner, indices, search, tweets, snapshot |
| **Toplam** | **53** | |

### Dizin Yapisi

```
hisse-analizi-dashboard/
├── src/                        <- Python backend
│   ├── api/                    <- FastAPI app + router + dependencies
│   ├── adapters/               <- 15 veri kaynagi adapter'i + utils (cache, http client)
│   ├── core/                   <- Config, enums, logging, time (utcnow)
│   ├── db/                     <- Models (13 tablo), repository (ON CONFLICT), session
│   ├── services/               <- Event, notification, analysis, financial
│   ├── workers/                <- Polling + notification worker (ayri proses)
│   └── static/                 <- Vanilla JS dashboard (prototip)
├── dashboard/                  <- Next.js 14 frontend
│   ├── src/app/                <- 7 sayfa (App Router)
│   ├── src/components/         <- UI bilesenleri (layout, shared, dashboard)
│   ├── src/lib/                <- API client, format utils, query client
│   └── Dockerfile              <- Multi-stage production build
├── alembic/                    <- DB migration'lari (001 + 002)
├── tests/                      <- Unit + integration (49+ test)
├── scripts/                    <- Seed, backfill, debug
├── docker-compose.yml          <- 4 servis: db, app, worker, dashboard
└── pyproject.toml
```

---

## Siradaki Adimlar

- [ ] Docker Compose ile end-to-end calistirma testi
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] WebSocket ile gercek zamanli fiyat push
- [ ] Slack/Telegram bildirim kanallari
- [ ] Portfoy takibi modulu
- [ ] Claude API ile AI sentiment analizi
- [ ] Test coverage 80%+ hedefi
