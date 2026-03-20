# Hisse Analizi Dashboard — Proje Baglamı

## Proje
- Repo: github.com/bugraguclu/hisse-analizi-dashboard
- Stack: Python/FastAPI + Next.js, PostgreSQL, Docker
- Desteklenen hisseler: Tum BIST sirketleri (780+), varsayilan: THYAO

## Mimari
- Backend: Python/FastAPI (53+ endpoint)
- Frontend: Next.js 14 (dashboard/ klasoru)
- DB: PostgreSQL 16 (async, SQLAlchemy 2.x)
- Deploy: Docker Compose (db, app, worker, dashboard)

## Calistirma
```bash
docker-compose up -d
```
- Backend: http://localhost:8000
- Dashboard: http://localhost:3000
- API Docs: http://localhost:8000/docs

## Notlar
- .env dosyasi .env.example'dan kopyalanmali
- Alembic migration: `alembic upgrade head`
- Seed: `python scripts/seed.py`
