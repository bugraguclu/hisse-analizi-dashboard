# Proje Yol Haritasi — Hisse Analizi Dashboard

## Proje Durumu: Faz 5 (Production Hardening) tamamlandi — v0.5.0

---

## Tamamlananlar

### Faz 0 — Altyapi (14 Mart 2026)
- [x] Git + GitHub repo kurulumu
- [x] Docker duzeltmeleri (Dockerfile, docker-compose)
- [x] Alembic migration klasoru
- [x] FastAPI backend yapisi
- [x] 36 unit test

### Faz 1 — Multi-Stock / BIST 30 (15 Mart 2026)
- [x] 30 BIST sirketi seed'e eklendi
- [x] KAP ve fiyat adapterlari dinamik hale getirildi
- [x] Polling worker tum sirketler icin calisiyor
- [x] API'ye ticker filtresi eklendi

### Faz 2 — borsapy Tam Entegrasyon (15 Mart 2026)
- [x] 15 adapter sinifi
- [x] 53+ API endpoint
- [x] Swagger dokumantasyonu otomatik
- [x] Teknik analiz (RSI, MACD, Bollinger, SMA, EMA, SuperTrend, Stochastic)
- [x] Temel analiz (sirket bilgileri, bilanco, gelir tablosu, temettu)
- [x] Makro veriler (TCMB, enflasyon, doviz, takvim)
- [x] Hisse tarama (screener) ve teknik sinyal tarama (scanner)

### Faz 3 — Finansal Analiz & NLP (20 Mart 2026)
- [x] FinancialStatement ve FinancialRatio modelleri
- [x] AnalysisService — 8 finansal oran (ROE, ROA, margin, debt)
- [x] NLP keyword siniflandirma (7 kategori)
- [x] FinancialAdapter (borsapy: bilanco, gelir tablosu, nakit akis)
- [x] Alembic initial migration (13 tablo)
- [x] GET /financials ve GET /financials/ratios endpoint'leri

### Faz 4 — Dashboard UI (20 Mart 2026)
- [x] Vanilla JS prototip (5 bolum)
- [x] Next.js 14 dashboard (7 sayfa)
- [x] shadcn/ui + Recharts + React Query
- [x] Proje genelleme (AEFES → THYAO)
- [x] Docker Compose ile tek komutla deploy

### Faz 5 — Production Hardening (21 Mart 2026)
- [x] Worker proses izolasyonu (API'den bagimsiz)
- [x] Admin API Key authentication (X-Admin-Key)
- [x] Config-driven CORS allowlist
- [x] slowapi rate limiting
- [x] Production config validation (fail-fast)
- [x] PostgreSQL ON CONFLICT upsert (tum repository'ler)
- [x] Outbox: SELECT...FOR UPDATE SKIP LOCKED
- [x] Notification idempotency (unique constraint + atomic insert)
- [x] PostgreSQL advisory lock (polling koordinasyonu)
- [x] Worker semaphore concurrency
- [x] TTL in-memory cache (adapter sonuclari)
- [x] Shared httpx.AsyncClient (connection pooling)
- [x] asyncio.to_thread() (modern async pattern)
- [x] Merkezi utcnow() (UTC-aware timestamps)
- [x] Content-based financial hashing
- [x] CRLF injection prevention (email headers)
- [x] Frontend TypeScript tip hizalamasi
- [x] Dead code temizligi (routers_extended.py, models_extended.py)
- [x] Docker hardening (no -e, no --reload, parametrik credentials)
- [x] 7 yeni test dosyasi (49+ test)

---

## Mevcut Durum

| Bilesen | Sayi | Durum |
|---------|------|-------|
| API Endpoints | 53 | Aktif, rate limited, admin auth |
| Adapterlar | 15 | Aktif, cached, shared HTTP client |
| DB Tablolari | 13 | Migration hazir (001 + 002) |
| Repository | ON CONFLICT | Atomic upsert, race-safe |
| Servisler | 4 | Event, Notification, Analysis, Financial |
| Workerlar | 2 | Ayri proses, advisory lock, semaphore |
| Unit Test | 49+ | Pass |
| Guvenlik | 6 katman | Auth, CORS, rate limit, dedup, sanitize, validation |

---

## Siradaki: Faz 6 — CI/CD & Gelismis Ozellikler

### 6.1 — CI/CD & DevOps
- [ ] GitHub Actions pipeline (lint, test, build, deploy)
- [ ] Test coverage raporlama (hedef: 80%+)
- [ ] Otomatik Docker image build + push

### 6.2 — Gercek Zamanli Veri
- [ ] WebSocket canli fiyat push
- [ ] Dashboard auto-refresh (SSE veya WebSocket)

### 6.3 — Bildirim Kanallari
- [ ] Slack entegrasyonu
- [ ] Telegram bot

### 6.4 — Portfoy Takibi
- [ ] Portfoy olusturma
- [ ] Kar/zarar takibi
- [ ] Performans grafikleri

### 6.5 — AI Entegrasyonu
- [ ] Claude API ile KAP bildirim sentiment analizi
- [ ] Otomatik severity tespiti
- [ ] Haber ozet olusturma
