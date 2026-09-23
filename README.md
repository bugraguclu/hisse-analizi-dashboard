# Hisse Analizi Dashboard

[![CI](https://github.com/bugraguclu/hisse-analizi-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/bugraguclu/hisse-analizi-dashboard/actions/workflows/ci.yml)

Borsa İstanbul için piyasa takibi ve analiz uygulaması. Next.js arayüzü; FastAPI, PostgreSQL ve bağımsız worker servisleriyle çalışır.

> Yatırım tavsiyesi değildir. Veriler karar desteği amacıyla sunulur ve yatırım kararı öncesinde birincil kaynaktan doğrulanmalıdır.

## Özellikler

- BIST endeksleri, piyasa genişliği, günün en çok yükselen/düşen hisseleri ve takip listesi
- Hisse sayfası: fiyat/hacim grafiği, günlük değişim, KAP bildirimleri, haberler (duygu etiketiyle), analist hedefleri, temettü, ortaklık yapısı
- Teknik analiz: RSI, MACD, Bollinger, SMA/EMA, SuperTrend, Stochastic, pivot ve dokuz zaman diliminde TradingView özeti
- Temel analiz: KAP bilanço, gelir ve nakit akışı tabloları (dönem, birim ve kümülatif/çeyreklik etiketiyle); son 12 ay (TTM) oranları
- TCMB politika faizi ve koridor, TÜFE, döviz kurları, ekonomik takvim
- Hazır şablon ve filtrelerle hisse tarama, teknik sinyal taraması
- KAP/haber arşivi (önem ve kategori filtreleri) ve e-posta bildirim altyapısı
- Türkçe/İngilizce/Fransızca, koyu/açık tema, mobil uyumlu arayüz

Eksik veri `0` gibi gösterilmez; API hatası, boş veri ve yükleniyor durumları arayüzde ayrı ele alınır.

## Veri kaynakları

Veriler PostgreSQL'de köken bilgisiyle (`source`, `fetched_at`, verinin kendi tarihi) saklanır ve
**depo öncelikli** servis edilir: depo tazeyse oradan, değilse canlı çekilip depoya yazılır,
sağlayıcı yanıt vermezse son iyi kopya `stale: true` ile döner. Her yanıt bir `meta` bloğu taşır
(`source`, `source_url`, `as_of`, `fetched_at`, `age_seconds`, `served_from: live|store|stale`,
`stale`, `delay_seconds`, `notes`); liste uçları aynı bilgiyi `X-Data-*` başlıklarında verir.
Ayrıntılar: [docs/data-platform.md](./docs/data-platform.md).

| Veri | Birincil kaynak | Doğrulama / yedek |
|---|---|---|
| Şirket evreni (~630 hisse), endeks üyelikleri | Borsa İstanbul resmî bileşen dosyası + TradingView tarayıcı + KAP şirket kartı (OID, sektör, pazar, halka açıklık) | İş Yatırım şirket kartı |
| Kotasyon (15 dk gecikmeli), günlük barlar | TradingView (tek istekte tüm evren; barlar bölünme düzeltmeli) | İş Yatırım `HisseTekil`/`OneEndeks` (resmî kapanış, TL ciro, AOF; kapanış mutabakatı) |
| Bilanço, gelir tablosu, nakit akışı | KAP finansal özet (ilk açıklanan, resmî) | İş Yatırım MaliTablo (çeyrekler; IAS 29 yeniden ifade katsayısıyla KAP bazına çevrilir) |
| Oranlar (TTM ve yıllık) | Depodaki kanonik kalemlerden hesaplanır (`inputs_json` ile yeniden üretilebilir) | TradingView oranları (kalite kontrolü) |
| Temettü, sermaye artırımı, ortaklık yapısı, hedef fiyat, KAP takvimi | İş Yatırım, KAP/MKK, hedeffiyat.com.tr, KAP beklenen bildirimler | — |
| Politika faizi/koridor, TÜFE/ÜFE, döviz bülteni | TCMB sayfaları ve günlük kur XML'i (isteğe bağlı EVDS3) | borsapy, TradingView (kalite kontrolü) |
| Şirket bildirimleri | KAP | — |
| Haberler | Google News RSS | — |

## Mimari

```
Tarayıcı ──> Next.js (dashboard, :3000) ──/api/*──> FastAPI (app, :8000) ──> PostgreSQL (db)
                                                                ▲
        worker (KAP, haber, bildirim + veri platformu: evren/referans, piyasa, temel analiz, makro, kalite) ─┘
```

- Tarayıcı yalnızca Next.js ile konuşur; `/api/*` istekleri aynı origin üzerinden FastAPI’ye iletilir.
- Worker ayrı bir süreçtir; her zaman tek replika ile çalıştırılır. Veri platformu döngüleri (`reference`, `market`, `fundamentals`, `macro`, `quality`) `ingestion_runs` tablosuna iş kaydı yazar; durum `GET /data/status`, kalite kontrolleri `GET /data/quality` ile izlenir. Kaynak taraması (advisory lock) ve outbox (`FOR UPDATE SKIP LOCKED`) çoklu replikaya güvenli olsa da haber döngüsü değildir.
- Production’da Caddy önde durur, otomatik HTTPS sağlar ve yalnızca 80/443 dışarı açılır.

## Hızlı başlangıç (Docker)

Gereksinimler: Docker ve Docker Compose v2.24+.

```bash
git clone https://github.com/bugraguclu/hisse-analizi-dashboard.git
cd hisse-analizi-dashboard
cp .env.example .env

docker compose up --build -d                 # migration'lar migrate servisiyle otomatik çalışır
docker compose exec app python scripts/seed.py   # BIST 100 şirketleri ve kaynaklar (tekrar çalıştırılabilir)
```

| Servis | Adres |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000 |
| Swagger | http://localhost:8000/docs |
| Health / readiness | http://localhost:8000/health, `/health/ready` |

Mail testi için: `docker compose --profile mail up -d mailhog` (arayüz: http://localhost:8025).

## Production

```bash
# .env içinde en az: POSTGRES_PASSWORD, ADMIN_API_KEY (≥ 24 karakter; örn. `openssl rand -hex 32`), CORS_ORIGINS=https://<DOMAIN>,
# DOMAIN, ACME_EMAIL, APP_ENV=production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app python scripts/seed.py
```

- `DOMAIN` için DNS kaydı ilk başlatmadan önce sunucuyu göstermelidir (Let’s Encrypt doğrulaması). Sertifikalar otomatik yenilenir.
- Yalnızca Caddy (80/443) dışarı açılır; veritabanı, API ve Next.js yalnızca compose ağında erişilebilir.
- Uygulama; eksik/kısa `ADMIN_API_KEY`, varsayılan veritabanı parolası veya `*` CORS ile başlamayı reddeder.
- Yedekleme: `scripts/backup.sh` (gzip, zaman damgalı, gün bazlı saklama) ve `scripts/restore.sh`. Düzenli çalıştırmak için cron’a ekleyin.
- Yayından sonra `/health/ready`, `/stats`, `/events` ve hisse sayfalarını doğrulayın; hata takibi ve uptime izlemesini deployment katmanında kurun.

## Yapılandırma

Tüm ayarlar açıklamalarıyla [`.env.example`](./.env.example) dosyasındadır. Başlıcaları:

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_SYNC` | PostgreSQL bağlantıları (async uygulama / alembic) |
| `ADMIN_API_KEY` | `X-Admin-Key` ile korunan yönetim uç noktaları; production’da zorunlu |
| `CORS_ORIGINS` | İzin verilen origin’ler |
| `TRUSTED_PROXIES` | `X-Forwarded-For` başlığına güvenilen proxy adresleri (istemci bazlı oran sınırı) |
| `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_ADMIN` | İstemci başına genel ve yönetim uç noktası sınırları |
| `GEMINI_API_KEY` veya `ANTHROPIC_API_KEY` | İsteğe bağlı haber duygu sınıflandırması |
| `AI_DAILY_BUDGET_USD` | Günlük LLM harcama sınırı |
| `SMTP_*`, `ENABLE_REAL_EMAIL` | İsteğe bağlı gerçek e-posta gönderimi (varsayılan: kuru çalıştırma) |
| `MARKET_*`, `FUNDAMENTALS_*`, `REFERENCE_*`, `MACRO_*`, `QUALITY_*` | Veri platformu: worker zamanlamaları, depo tazelik pencereleri, KAP/İş Yatırım nezaket aralıkları, kalite eşikleri (`MACRO_EVDS_API_KEY` ile EVDS3 açılır) |
| `API_URL`, `TRUSTED_PROXY_HOPS` | Next.js → FastAPI adresi ve Next önündeki proxy sayısı ([`dashboard/.env.example`](./dashboard/.env.example)) |

AI anahtarı yoksa haberler duygu etiketi olmadan saklanır; sistemin geri kalanı çalışır.

## Yerel geliştirme

Backend (PostgreSQL için `docker compose up -d db` yeterlidir):

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev,email]"
cp .env.example .env
alembic upgrade head
python scripts/seed.py
uvicorn src.api.app:app --reload
python -m src.workers.run_workers    # ayrı terminalde, isteğe bağlı
```

Frontend:

```bash
cd dashboard
cp .env.example .env.local
npm ci
npm run dev
```

## Kontroller

```bash
ruff check src tests
mypy src
SKIP_NETWORK_TESTS=1 pytest -q

cd dashboard
npm run lint -- --max-warnings=0
npx tsc --noEmit
npm run build
npm audit --omit=dev --audit-level=high
```

`pg_session` fixture'ı (tests/conftest.py) gerçek PostgreSQL davranışını (`TEST_DATABASE_URL`, varsayılan `hisse_analizi_test`) ayrı bir şemada test eder; veritabanı yoksa bu testler atlanır. CI aynı kontrollere ek olarak migration gidiş-dönüş testini (`upgrade → downgrade base → upgrade`), Compose doğrulamasını ve iki Docker imajının derlenmesini çalıştırır. Canlı sağlayıcı testleri `tests/integration` altındadır (`SKIP_NETWORK_TESTS=1` ile atlanır).

## API

OpenAPI sözleşmesi çalışma zamanında üretilir: Swagger `/docs`, ReDoc `/redoc`, JSON `/openapi.json`.

- Uç nokta grupları: sistem/arşiv, teknik analiz, temel analiz, piyasa, makro, haber ve `X-Admin-Key` korumalı yönetim işlemleri.
- Hatalar her zaman `{"detail": "<Türkçe mesaj>"}` biçimindedir; her yanıt `X-Request-ID` taşır.
- Geçersiz sembol 400, bilinmeyen sembol 404, veri sağlayıcı hatası 502/503 döner. `/events` toplam kayıt sayısını `X-Total-Count` başlığında verir.
- Veri yanıtları eklemeli `meta` bloğu taşır (`served_from`, `stale`, `as_of`, `delay_seconds`…); `GET /companies` varsayılan olarak çekirdek (BIST 100) katmanı döner (`?tier=universe|all`, `?include_inactive=true`).
- `GET /data/status` alan bazında tazelik/iş durumu, `GET /data/quality` çapraz kaynak kontrol sonuçları; `POST /admin/data/refresh` ve `POST /admin/data/quality/run` yönetim tetikleyicileridir.

Değişiklik geçmişi [CHANGELOG.md](./CHANGELOG.md), iş özeti [PROJE_OZETI.md](./PROJE_OZETI.md) dosyasındadır.

## Lisans

Bu depoda açık kaynak lisansı tanımlanmamıştır. Yeniden kullanım ve dağıtım için depo sahibinden izin alınmalıdır.
