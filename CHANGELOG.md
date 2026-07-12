# Degisiklik Gunlugu (Changelog)

Tum onemli degisiklikler burada tarih sirasiyla belgelenir.

---

## [v0.8.0] — 12 Temmuz 2026

**Branch:** `master`

### Faz 2 — Haber + AI Yorumlama (Roadmap)
- **Google News RSS adapter'i** (`src/adapters/news.py`): hisse bazli Turkce haber toplama (baslik, kaynak, tarih, ozet — yalnizca RSS meta verisi, kullanim kosullarina uygun).
- **Migration 004**: `news_items` tablosu (url UNIQUE dedup, sentiment/impact/rationale alanlari).
- **Haber worker'i** (`src/workers/news_worker.py`): 15 dk'da bir BIST 100 taramasi (es zamanlilik siniri 4); ilk turda 102 sirketten 473 haber toplandi.
- **AI siniflandirici** (`src/services/news_service.py`): yeni haberler tek LLM cagrisiyla duygu (pozitif/notr/negatif) + etki (yuksek/orta/dusuk) + kisa gerekce etiketi alir; anahtar yoksa etiketsiz saklanir, anahtar gelince yeni haberler otomatik etiketlenir.
- **`GET /news/{ticker}?hours=48`**: etiketli haber listesi.
- **AI rapor beslemesi**: son 48 saatin haber ozeti (duygu dagilimi + basliklar) rapor snapshot'ina eklendi — onemli haber cikinca hash degisir, rapor otomatik yenilenir. Prompt'a "Gundemde Ne Var?" bolumu eklendi.
- **Frontend**: hisse sayfasina "Haberler (48s)" bolumu — kaynaga tiklanabilir basliklar, duygu/etki rozetleri (yesil pozitif / sari notr / kirmizi negatif), rozet uzerinde AI gerekcesi (tooltip).
- **Kritik altyapi duzeltmesi** (`src/adapters/utils.py`): paylasilan httpx client'in `Timeout` kurulumu eksikti (default'suz — kullanan ilk cagri patliyordu) ve Docker VM'de IPv6 cikisi olmadigi icin IPv6'ya cozulen hostlara (news.google.com) baglanti kurulamiyordu; timeout default eklendi, transport IPv4'e sabitlendi.
- Versiyon 0.8.0.

---

## [v0.7.0] — 12 Temmuz 2026

**Branch:** `master`

### AI Motoru: Google AI Studio (Gemini) + kanita dayali rapor formati
- **Saglayici-secmeli mimari** (`AI_PROVIDER=gemini|anthropic`, varsayilan gemini): `src/adapters/llm.py` yeniden yapilandirildi — `GeminiClient` (google-genai SDK, `gemini-3.5-flash`) ve `AnthropicClient` ayni arayuzu sunar, gunluk $5 butce kesici iki saglayici arasinda PAYLASILIR.
- **Zengin veri beslemesi**: snapshot artik 30 gunluk fiyat serisi (gunluk kapanis+hacim, 1G/1H/1A degisimler), canli temel gostergeler (fast_info: piyasa degeri, F/K, 52H araligi...), teknik sinyaller, 4 doneme kadar finansal oranlar, son 10 KAP olayi (onem dereceli) ve makro baglam (TCMB politika faizi, enflasyon, USD/TRY aylik degisim) iceriyor.
- **Kanita dayali amator-dostu prompt** (`report_tr.md` v2): her iddia JSON'daki somut degere "(kanit: ...)" formatiyla baglanmak zorunda; fiyat hareketleri tarihleriyle KAP/makro olaylarina eslestirilir, eslesme yoksa "veri bunu kanitlamiyor" denir; her jargon ilk kullanimda parantez ici sade aciklamayla tanimlanir; rapor "Bu Sonuca Nasil Vardim?" bolumuyle akil yurutme zincirini gosterir. SPK kurallari korundu.
- Gece worker'i saglayiciya duyarli: anthropic'te Message Batches API (%50 indirim), gemini'de butce-korumal sirali uretim.
- `/ai/status` artik saglayici + aktif modeli gosterir; 503 mesajlari saglayiciya ozel (GEMINI_API_KEY yonergesi AI Studio linkiyle).
- `.env` ve `.env.example`'a `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` eklendi; `google-genai` bagimliligi.
- Versiyon 0.7.0.

---

## [v0.6.0] — 11 Temmuz 2026

**Branch:** `master`

### Faz 1 — AI Core (Roadmap)
- **LLM adapter** (`src/adapters/llm.py`): Anthropic Claude sarmalayici — prompt caching (sistem talimati `cache_control` ile, ~%90 girdi tasarrufu), model bazli maliyet hesabi, gunluk butce devre kesici (`AI_DAILY_BUDGET_USD`, varsayilan $5), streaming destegi. Modeller: rapor icin `claude-sonnet-5` (intro fiyat $2/$10 per MTok, 2026-08-31'e kadar), siniflandirma icin `claude-haiku-4-5` (yapilandirilabilir).
- **Migration 003**: `ai_reports` tablosu (content_hash UNIQUE ile Generate-Once cache, input_data_json, token sayaclari).
- **Turkce sistem promptu** (`src/services/prompts/report_tr.md`): sadece verilen JSON'a dayali analiz, SPK uyari zorunlulugu, al/sat tavsiyesi yasagi.
- **AI servisi** (`src/services/ai_service.py`): snapshot toplama (fiyat + teknik sinyaller + finansal oranlar + son 5 KAP olayi) → SHA-256 hash → cache kontrolu → Claude cagrisi → DB kayit.
- **Yeni endpointler** (`/ai/*`, 3/dk rate limit): `GET /ai/status`, `GET /ai/report/{ticker}` (cache'li JSON), `GET /ai/report/{ticker}/stream` (SSE token akisi), `POST /ai/report/{ticker}/regenerate` (admin).
- **Gece batch worker** (`src/workers/ai_report_worker.py`): hash'i degisen BIST 100 hisseleri icin Message Batches API ile %50 indirimli toplu uretim. `AI_NIGHTLY_BATCH_ENABLED=true` ile acilir.
- **Frontend**: "AI Analiz Raporu" butonu artik SSE stream endpoint'ini tuketiyor — daktilo efektiyle canli akis, cache'te varsa aninda tam metin, hata durumunda backend `detail` mesaji gosteriliyor.
- `ANTHROPIC_API_KEY` tanimli degilse tum AI endpointleri kibar 503 doner; sistemin geri kalani etkilenmez.
- slowapi limiter `src/api/limiter.py`'a tasindi (app + router paylasimi icin).
- Dashboard Docker imaji yeniden derlendi (10 Temmuz'da Docker Hub erisim sorunu nedeniyle bekleyen tum UI duzeltmeleri artik canli).
- Versiyon 0.6.0 (pyproject, FastAPI app, HealthOut).

---

## [v0.5.1] — 10 Temmuz 2026

**Branch:** `master`

### Faz 0 Sertlestirme (Roadmap)
- Frontend API hatalari artik yutulmuyor: `get/post` hata firlatir, React Query hata durumlarini gosterebilir (`ApiError`).
- API base URL tek kaynakta (`API_BASE`, api.ts); Sidebar docs linki ve AI rapor fetch'i sabit `localhost:8000` yerine bunu kullanir.
- `TTLCache` LRU ile sinirlandi (max 1000 kayit); `run_sync` sinirli thread havuzu kullanir (max 10).
- `scripts/seed.py` BIST 100'u borsapy `Index("XU100").components` uzerinden canli ceker (statik BIST 30 yedek listesi ile); DB'de 100+ sirket.
- `/admin/backfill` artik `days` ve `source_code` parametrelerini gercekten kullanir (`run_backfill`).
- `pyproject.toml`: versiyon 0.5.0, `borsapy>=0.10.2`.
- Olu kod temizligi: `anadoluefes_news.py`, `anadoluefes_ir.py`, ilgili fixture ve test kaldirildi.
- E-posta baslik sanitizasyonunda `\r\n` cift bosluk hatasi duzeltildi.

### Veri Dogrulugu Duzeltmeleri (kritik)
- **Grafik periyotlari**: Turkce periyotlar (`1g`, `1ay`, ...) borsapy'nin bekledigi `1d/1mo/... + interval` ciftlerine map edilir (`normalize_period`). Onceden TUM periyot sekmeleri ayni 30 gunluk veriyi gosteriyordu; 1G artik gercek 15 dakikalik gun ici veridir.
- **TCMB politika faizi**: borsapy 2010 satirini (%7,0) donduruyordu; `TCMB().history()` son satiri kullanilarak duzeltildi (%37,0 — 23 Oca 2026). `/macro/tcmb` tablosundaki policy satiri da duzeltilir.
- **`/macro/tcmb`**: var olmayan `interest_rates` yerine `.rates` kullanilir; makro sayfasi tabloyu artik gosterir.
- **Snapshot**: `FastInfo` `_data` altinda veri tuttugu icin bos donuyordu; `safe_serialize` mapping nesnelerini destekler. Snapshot cagrilari artik paralel (gather).
- **`/market/indices`**: sembol listesine ek olarak 12 ana endeks icin canli kotasyon (`quotes`: last, change_percent, prev_close) doner; sinirli eszamanlilik + retry ile 12/12 guvenilirlik.
- **`/fundamentals/{t}/live-ratios`**: fast_info her zaman merge edilir; F/K artik dolu.
- FX gecmisi icin gecersiz `1ay` periyodu `1mo` yapildi; fiyat polling adaptorundeki `1ay` da duzeltildi ve backfill icin gun bazli periyot secimi eklendi.

### UI Duzeltmeleri
- Dashboard BIST 100 grafigi: 1G icin gercek onceki kapanis referans cizgisi ve gunluk degisim; diger periyotlarda "Donem basi" etiketi (yaniltici "Onceki kapanis" yerine). Y ekseni artik "14.1K" yerine tam sayi gosterir.
- Piyasa Nabzi ve Tarama endeks kartlari canli kotasyon kullanir (aylik fark degil gercek gunluk degisim).
- "BIST Endeksleri" bolumu artik calisiyor (onceden hic render olmuyordu).
- Takip listesi: snapshot map'i dogru okunur, fiyat + gun araligi (dusuk–yuksek) gosterilir.
- Hisse sayfasi: canli OHLCV (fast_info), yeni ozet satiri (Piyasa Degeri, F/K, PD/DD, 52H yuksek/dusuk, Halka Aciklik, Yabanci Orani).
- Piyasa acik/kapali rozeti Istanbul saat dilimini kullanir.
- Makro: ekonomik takvim buyuk harfli anahtarlarla (Event/Date/Actual) dogru render edilir; politika faizi karar tarihi gosterilir.
- Analiz sayfasi: SINYALLER karti metadata (symbol/exchange/interval) yerine gercek oneri gruplarini gosterir; F/K ve PD/DD fast_info anahtarlarini da okur.
- Tarama tablosu: eksik degisim/hacim alanlari icin sahte "+0,00% / 0" yerine "-".

### Gelistirme Ortami
- `docker-compose.override.yml`: backend kaynak kodu konteynerlere mount edilir; imaj rebuild etmeden restart yeterli.

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
