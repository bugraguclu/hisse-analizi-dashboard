# Degisiklik Gunlugu (Changelog)

Tum onemli degisiklikler burada tarih sirasiyla belgelenir.

---

## [v0.5.0] — 21 Mart 2026

**Branch:** `master`

### Production Hardening

Bu surum, sistemin production ortamina hazirlanmasi icin kapsamli bir
guclendirme (hardening) calismasi icerir. 8 fazda 10 kritik mimari risk
giderilmistir.

### Yeni Ozellikler
- **Admin API Key Auth:** Tum admin endpoint'leri `X-Admin-Key` header ile korunuyor
- **Rate Limiting:** slowapi ile API rate limiting (varsayilan: 100/dakika)
- **CORS Allowlist:** Config-driven CORS origin listesi (hardcoded `*` kaldirildi)
- **TTL In-Memory Cache:** Adapter sonuclari icin TTL bazli on-bellek (30s-600s arasi)
- **PostgreSQL Advisory Lock:** Polling worker'da kaynak bazli koordinasyon kilidi
- **Outbox Claim Semantics:** `SELECT...FOR UPDATE SKIP LOCKED` ile yarisma-guvenli outbox
- **Notification Idempotency:** DB unique constraint + atomic insert ile cift gonderim onleme
- **Content-Based Financial Hashing:** Tarih yerine icerik bazli hash ile finansal veri dedup
- **CRLF Injection Prevention:** E-posta header sanitizasyonu
- **Production Config Validation:** Zorunlu secret'larin eksikliginde fail-fast

### Degisiklikler
| Alan | Ne Degisti |
|------|-----------|
| Worker Izolasyonu | Worker artik API lifespan'den bagimsiz; ayri proses olarak calisir |
| DB Upsert | Tum `select-then-insert` kaliplari PostgreSQL `ON CONFLICT` upsert'e donusturuldu |
| Timestamps | `datetime.now()` → `utcnow()` (UTC-aware, merkezi fonksiyon) |
| Async Pattern | `asyncio.get_event_loop().run_in_executor()` → `asyncio.to_thread()` |
| HTTP Client | Her adapter'da ayri client → paylasimli `httpx.AsyncClient` (connection pool) |
| DB Pool | `pool_pre_ping=True`, `pool_recycle=300` eklendi |
| Frontend Types | `dashboard/src/types/index.ts` backend Pydantic semalarina hizalandi |
| Frontend Cache | Endpoint bazli cache stratejisi (no-store / default) |
| SeverityBadge | CRITICAL/HIGH/MEDIUM/LOW → HIGH/WATCH/INFO (backend enum'a uyum) |
| StatsCards | `total_companies` → `total_raw_events` (backend'de olmayan alan duzeltildi) |
| Docker | `-e` (editable install) kaldirildi, `--reload` kaldirildi, credentials parametrik |

### Yeni Dosyalar
| Dosya | Aciklama |
|-------|----------|
| `src/core/time.py` | Merkezi `utcnow()` fonksiyonu |
| `src/api/dependencies.py` | Admin auth dependency (X-Admin-Key) |
| `src/adapters/utils.py` | TTLCache, cached decorator, shared HTTP client, run_sync, df_to_records |
| `alembic/versions/002_*.py` | Notification dedup constraint migration |
| `tests/unit/test_ttl_cache.py` | TTL cache testleri |
| `tests/unit/test_time.py` | UTC time testleri |
| `tests/unit/test_config.py` | Config validation testleri |
| `tests/unit/test_notification_sanitize.py` | Header sanitization testleri |
| `tests/unit/test_serialization.py` | Serialization utility testleri |
| `tests/unit/test_admin_auth.py` | Admin auth testleri |
| `tests/unit/test_financial_hashing.py` | Content-based hash testleri |

### Silinen Dosyalar
| Dosya | Neden |
|-------|-------|
| `src/api/routers_extended.py` | Dead code — var olmayan siniflari import ediyordu |
| `src/db/models_extended.py` | Bos uyumluluk dosyasi, artik gereksiz |

### Istatistikler
- **44 dosya** degistirildi (+1284 / -998 satir)
- **7 yeni test dosyasi**, toplam 49+ test
- **10 kritik mimari risk** giderildi
- **53 endpoint** (degisiklik yok, sadece guvenlik eklendi)

---

## [v0.4.0] — 20 Mart 2026

**Branch:** `master`

### Yeni Ozellikler
- **Next.js Dashboard:** 7 sayfa (Dashboard, Olaylar, Hisse Detay, Teknik, Temel, Makro, Tarama)
- **Docker Compose:** Dashboard servisi eklendi, tek komutla tum sistem ayaga kalkar
- **shadcn/ui + Recharts:** Modern fintech temali UI, grafikler ve tablolar
- **React Query:** 30sn cache, otomatik refetch

### Degisiklikler
- Proje "AEFES Listener"dan genel BIST analiz platformuna yeniden adlandirildi
- Tum hardcoded `AEFES` default degerleri `THYAO` ile degistirildi
- DB adi `aefes_listener` -> `hisse_analizi` olarak guncellendi
- DB kullanicisi `aefes` -> `hisse` olarak guncellendi
- User-Agent `AEFESListener/1.0` -> `HisseAnalizi/1.0` olarak guncellendi
- Yol haritasi guncellendi (Faz 4 eklendi)

### Istatistikler
- **50 dosya** eklendi (dashboard/)
- **75 referans** guncellendi (AEFES -> THYAO, aefes_listener -> hisse_analizi)
- **7 sayfa** Next.js dashboard
- **53 endpoint** backend (degisiklik yok)

---

## [v0.3.0] — 20 Mart 2026

**Branch:** `master` (feature/ai-financial-assistant merge)

### Yeni Ozellikler
- **Finansal Analiz Sistemi:** FinancialAdapter ile borsapy uzerinden bilanco, gelir tablosu, nakit akis cekme ve DB'ye kaydetme
- **AnalysisService:** 8 finansal oran otomatik hesaplama (ROE, ROA, net/gross/ebitda margin, debt_to_equity, current_ratio, net_debt_ebitda)
- **NLP Siniflandirma:** KAP bildirimlerini keyword bazli kategorilere ayirma (temettu, sermaye artirimi, hukuki, yonetim vb.)
- **Alembic Migration:** 13 tablo icin initial migration dosyasi
- **Yeni Endpoint'ler:** GET /financials, GET /financials/ratios
- **Developer Test UI v0.3.0:** Finansal tablolar bolumu eklendi

### Degisiklikler
| Dosya | Ne Degisti |
|-------|-----------|
| `src/core/enums.py` | EventCategory enum + SourceKind.FINANCIAL_STATEMENTS eklendi |
| `src/db/models.py` | FinancialStatement, FinancialRatio modelleri + NormalizedEvent.category kolonu |
| `src/db/repository.py` | FinancialStatementRepository, FinancialRatioRepository eklendi |
| `src/services/event_service.py` | NLP siniflandirma + FinancialService eklendi |
| `src/services/analysis_service.py` | Yeni — 8 finansal oran hesaplama |
| `src/adapters/financial_adapter.py` | Yeni — borsapy finansal tablo adapter |
| `src/workers/polling_worker.py` | financials source destegi (3600sn interval) |
| `src/api/routers.py` | /financials ve /financials/ratios endpoint'leri |
| `src/schemas/events.py` | FinancialStatementOut, FinancialRatioOut, StatsOut guncellendi |
| `scripts/seed.py` | financials source eklendi |
| `alembic/versions/001_full_schema_v1.py` | Yeni — 13 tablo migration |

### Istatistikler
- **9 commit**
- **~800 satir** kod eklendi
- **53 endpoint** (onceki: 51)
- **38 unit test** (onceki: 36)

---

## [v0.2.0] — 15 Mart 2026

**Branch:** `feature/multi-stock`

### Yeni Ozellikler
- **BIST 30 Destegi:** Proje artik sadece AEFES yerine 30 hisseyi takip ediyor
- **25+ Yeni API Endpoint:** Finansal tablolar, teknik gostergeler, makro veriler, screener
- **Dinamik Adapter'lar:** KAP ve fiyat adapterlari artik herhangi bir hisse icin calisiyor
- **Swagger Dokumantasyonu:** http://localhost:8000/docs adresinde interaktif API testi

### Yeni Dosyalar
| Dosya | Aciklama |
|-------|----------|
| `src/adapters/fundamentals.py` | Bilanco, gelir tablosu, temettu adapterlari |
| `src/adapters/macro.py` | TCMB, doviz, endeks, ekonomik takvim |
| `src/adapters/technical.py` | RSI, MACD, Bollinger, SMA, EMA, screener |
| `docs/mimari.md` | Sistem mimarisi dokumani |
| `docs/api-rehberi.md` | API kullanim kilavuzu |
| `docs/yol-haritasi.md` | Proje yol haritasi |
| `docs/katki-rehberi.md` | Katki ve kurulum rehberi |

### Istatistikler
- **~1.500 satir** kod ve dokuman eklendi
- **30 sirket** veritabanina yuklendi

---

## [v0.1.0] — 14 Mart 2026

**Branch:** `master`

### Proje Olusturuldu
- FastAPI backend yapisi kuruldu
- PostgreSQL + Docker Compose altyapisi
- KAP bildirimleri ve fiyat verisi cekme (sadece AEFES)
- Bildirim sistemi (outbox pattern)
- Temel API endpoint'leri
