# Hisse Analizi Dashboard

[![CI](https://github.com/bugraguclu/hisse-analizi-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/bugraguclu/hisse-analizi-dashboard/actions/workflows/ci.yml)

Borsa İstanbul için piyasa takibi ve analiz uygulaması. Next.js arayüzü; FastAPI, PostgreSQL ve bağımsız worker servisleriyle çalışır.

> Yatırım tavsiyesi değildir. Veriler karar desteği amacıyla sunulur ve yatırım kararı öncesinde birincil kaynaktan doğrulanmalıdır.

## Özellikler

- BIST endeksleri, fiyat/hacim grafikleri ve takip listesi
- RSI, MACD, Bollinger, SMA/EMA, SuperTrend, Stochastic, pivot ve çoklu zaman dilimi sinyalleri
- Resmî KAP bilanço ve gelir tabloları; nakit akışı, temettü, ortaklık ve analist hedefleri
- TCMB politika faizi, enflasyon, döviz kurları ve ekonomik takvim
- Temel filtreler ve teknik sinyallerle hisse tarama
- KAP/haber arşivi ve e-posta bildirim altyapısı
- İsteğe bağlı Gemini veya Anthropic analiz raporu
- Türkçe/İngilizce, koyu/açık tema ve responsive arayüz

Eksik upstream veri `0` gibi gösterilmez. API hatası ve boş veri arayüzde ayrı durumlar olarak ele alınır.

## Veri kaynakları

| Veri | Kaynak |
|---|---|
| Bilanço ve gelir tablosu | KAP |
| Fiyat, endeks, teknik analiz ve tarama | `borsapy` üzerinden BIST/İş Yatırım/TradingView |
| Politika faizi, enflasyon ve döviz | TCMB/TÜİK |
| Haberler | KAP ve Google News RSS |

Finansal tablolarda dönem, sunum birimi ve kaynak bilgisi korunur. Veri kalite sözleşmeleri otomatik testlerle kontrol edilir. Ürün kapsamının kısa iş özeti [PROJE_OZETI.md](./PROJE_OZETI.md) dosyasındadır.

## Hızlı başlangıç

Gereksinimler: Docker ve Docker Compose v2.

```bash
git clone https://github.com/bugraguclu/hisse-analizi-dashboard.git
cd hisse-analizi-dashboard
cp .env.example .env

docker compose up --build -d
docker compose exec app alembic upgrade head
docker compose exec app python scripts/seed.py
```

| Servis | Adres |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000 |
| Swagger | http://localhost:8000/docs |
| Health | http://localhost:8000/health |

Mail testi gerektiğinde:

```bash
docker compose --profile mail up -d mailhog
```

MailHog arayüzü `http://localhost:8025` adresindedir.

## Yapılandırma

Başlangıç şablonu [`.env.example`](./.env.example) dosyasıdır.

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_SYNC` | PostgreSQL bağlantıları |
| `ADMIN_API_KEY` | Production’da zorunlu yönetim anahtarı |
| `CORS_ORIGINS` | İzin verilen frontend origin’leri |
| `GEMINI_API_KEY` veya `ANTHROPIC_API_KEY` | İsteğe bağlı AI raporu |
| `AI_DAILY_BUDGET_USD` | Günlük LLM harcama sınırı |
| `SMTP_*`, `ENABLE_REAL_EMAIL` | İsteğe bağlı gerçek e-posta gönderimi |
| `API_URL` | Next.js sunucusunun FastAPI adresi |

AI anahtarı yoksa yalnızca `/ai/*` endpoint’leri devre dışı kalır.

## Yerel geliştirme

Backend:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev,email]"
cp .env.example .env
alembic upgrade head
python scripts/seed.py
uvicorn src.api.app:app --reload
```

Frontend:

```bash
cd dashboard
cp .env.example .env.local
npm ci
npm run dev
```

Tarayıcı `/api/*` isteklerini Next.js sunucusu üzerinden `API_URL` ile FastAPI’ye iletir. Backend kök adresi Swagger’a yönlenir.

## Kontroller

```bash
.venv/bin/ruff check src tests
.venv/bin/pytest -q

cd dashboard
npm run lint -- --max-warnings=0
npm run build
npm audit --audit-level=high

cd ..
docker compose config --quiet
```

CI aynı backend, frontend ve Compose kontrollerini push ve pull request’lerde çalıştırır. Canlı sağlayıcı testleri `tests/integration` altındadır.

## API

OpenAPI sözleşmesi çalışma zamanında üretilir:

- Swagger: `/docs`
- ReDoc: `/redoc`
- OpenAPI JSON: `/openapi.json`

Endpoint grupları: sistem/arşiv, teknik analiz, temel analiz, piyasa, makro, haber, AI ve `X-Admin-Key` korumalı yönetim işlemleri.

## Production notları

- `APP_ENV=production`, güçlü veritabanı parolaları, `ADMIN_API_KEY` ve açık bir `CORS_ORIGINS` değeri kullanın.
- Migration ve seed adımlarını release sırasında çalıştırın.
- Worker’ı tek replica ile başlatın.
- TLS, yedekleme, hata takibi ve uptime izlemesini deployment katmanında yapılandırın.
- `/health`, `/stats`, `/events`, `/news` ve temel canlı veri akışlarını yayından sonra doğrulayın.

Değişiklik geçmişi [CHANGELOG.md](./CHANGELOG.md) dosyasındadır.

## Lisans

Bu depoda açık kaynak lisansı tanımlanmamıştır. Yeniden kullanım ve dağıtım için depo sahibinden izin alınmalıdır.
