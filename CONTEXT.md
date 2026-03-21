# Hisse Analizi Dashboard — Proje Baglami

## Proje
- Repo: github.com/bugraguclu/hisse-analizi-dashboard
- Stack: Python/FastAPI + Next.js, PostgreSQL, Docker
- Desteklenen hisseler: Tum BIST sirketleri (780+), varsayilan: THYAO
- Versiyon: 0.5.0 (production-hardened)

## Mimari
- Backend: Python/FastAPI (53+ endpoint, rate limited, admin auth)
- Frontend: Next.js 14 (dashboard/ klasoru)
- DB: PostgreSQL 16 (async, SQLAlchemy 2.x, ON CONFLICT upsert, advisory locks)
- Worker: Ayri proses (API'den bagimsiz, semaphore ile sinirli concurrency)
- Cache: TTL in-memory cache (adapter sonuclari, 30s-600s)
- Guvenlik: X-Admin-Key auth, CORS allowlist, slowapi rate limiting
- Deploy: Docker Compose (4 servis: db, app, worker, dashboard)

## Calistirma
```bash
cp .env.example .env
# .env icinde ADMIN_API_KEY, CORS_ORIGINS, DB credentials ayarla
docker-compose up -d
docker-compose exec app alembic upgrade head
docker-compose exec app python scripts/seed.py
```
- Backend: http://localhost:8000
- Dashboard: http://localhost:3000
- API Docs: http://localhost:8000/docs

## Onemli Ortam Degiskenleri
- `DATABASE_URL` — PostgreSQL baglanti adresi
- `ADMIN_API_KEY` — Admin endpoint'leri icin API key (production'da zorunlu)
- `CORS_ORIGINS` — Izin verilen origin'ler (virgul ayirmali)
- `RATE_LIMIT_PER_MINUTE` — API rate limit (varsayilan: 100)
- `WORKER_MAX_CONCURRENCY` — Worker semaphore limiti
- `WORKER_SINGLE_REPLICA` — Tek worker replica zorunlulugu

## Notlar
- .env dosyasi .env.example'dan kopyalanmali
- Alembic migration: `alembic upgrade head` (001 + 002)
- Seed: `python scripts/seed.py`
- Admin endpoint'leri `X-Admin-Key` header gerektirir (dev modda bypass)
- Worker ayri proses olarak calisir (`src/workers/run_workers.py`)
