# Hisse Analizi Dashboard — Proje Bağlamı

Bu kısa belge geliştirici/agent oturumları için güncel başlangıç bağlamıdır. Kullanıcı dokümantasyonu için [README.md](./README.md) esas alınmalıdır.

## Ürün

- Repo: `github.com/bugraguclu/hisse-analizi-dashboard`
- Sürüm: `0.8.0`
- Kapsam: BIST piyasa görünümü; teknik, temel ve makro analiz; tarama; KAP/haber arşivi; isteğe bağlı AI raporu
- Varsayılan örnek sembol: `THYAO`
- Finansal tavsiye üretmez; kaynaklı karar desteği sunar

## Stack

- Backend: Python 3.11+, FastAPI, Pydantic, SQLAlchemy 2.x async
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Recharts, TanStack Query
- DB: PostgreSQL 16 + Alembic (`001`–`004`)
- Worker: API’den bağımsız polling/news/AI/notification görevleri
- Veri: KAP, TCMB ve `borsapy` üzerinden İş Yatırım/TradingView/BIST kaynakları
- Deploy: Docker Compose (`db`, `app`, `worker`, `dashboard`; opsiyonel `mailhog`)

## Kritik davranışlar

- Tarayıcı varsayılan olarak `/api/*` Next.js route handler üzerinden `API_URL` değerine bağlanır.
- Canlı adaptör endpoint’leri DB’den bağımsız çalışabilir; `/stats`, `/events`, `/news` ve AI rapor cache’i PostgreSQL’e bağlıdır.
- Upstream hatalar boş veri gibi gizlenmez; açıklayıcı HTTP hata durumu döner.
- Finansal tablolar resmî KAP dönem/sunum birimi metadata’sını korur.
- Admin endpoint’leri production’da `X-Admin-Key` ister.
- AI anahtarı yoksa AI endpoint’leri `503` döner, diğer bölümler çalışır.
- Worker production başlangıcında tek replica çalıştırılmalıdır.

## Çalıştırma

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec app alembic upgrade head
docker compose exec app python scripts/seed.py
```

- Dashboard: `http://localhost:3000`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`

## Doğrulama

```bash
.venv/bin/ruff check src tests
.venv/bin/pytest -q
cd dashboard && npm run lint -- --max-warnings=0 && npm run build
cd .. && docker compose config --quiet
```

Repo değişikliklerinde [CONTRIBUTING.md](./CONTRIBUTING.md), güvenlik bildirimlerinde [SECURITY.md](./SECURITY.md) izlenmelidir.
