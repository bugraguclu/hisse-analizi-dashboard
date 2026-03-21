# Katki Rehberi — Hisse Analizi Dashboard

## Gelistirme Ortami

### Gereksinimler
- **Docker Desktop** (Windows, WSL2 etkin) veya **PostgreSQL 16+** (local)
- **Python 3.11+**
- **Node.js 20+** (dashboard icin)
- **Git**

### Ilk Kurulum

```bash
# 1. Repo'yu klonla
git clone https://github.com/bugraguclu/hisse-analizi-dashboard.git
cd hisse-analizi-dashboard

# 2. .env dosyasini olustur
cp .env.example .env
# .env icinde su degiskenleri ayarla:
#   DATABASE_URL
#   ADMIN_API_KEY (production icin zorunlu)
#   CORS_ORIGINS (production icin zorunlu)

# 3. Docker ile baslat
docker-compose up -d --build

# 4. DB migration'larini calistir
docker-compose exec app alembic upgrade head

# 5. Sirket verilerini yukle
docker-compose exec app python scripts/seed.py

# 6. Test et
# Tarayicida ac: http://localhost:8000/docs
# Dashboard: http://localhost:3000
```

### Local Gelistirme (Docker'siz)

```bash
pip install -e ".[dev]"
cp .env.example .env
# .env icinde DATABASE_URL'i duzenle

alembic upgrade head
python scripts/seed.py

# Backend
uvicorn src.api.app:app --reload

# Worker (ayri terminal)
python -m src.workers.run_workers

# Dashboard (ayri terminal)
cd dashboard && npm install && npm run dev
```

---

## Ortam Degiskenleri

| Degisken | Aciklama | Varsayilan |
|----------|----------|------------|
| `DATABASE_URL` | PostgreSQL baglanti | - (zorunlu) |
| `ADMIN_API_KEY` | Admin endpoint auth | - (prod zorunlu) |
| `CORS_ORIGINS` | Izin verilen origin'ler | `*` (dev) |
| `RATE_LIMIT_PER_MINUTE` | API rate limit | 100 |
| `WORKER_MAX_CONCURRENCY` | Worker semaphore | 5 |
| `WORKER_SINGLE_REPLICA` | Tek worker zorunlu | false |
| `SMTP_HOST` | E-posta sunucusu | - |

---

## Git Calisma Kurallari

### Branch Isimlendirme
```
feature/dashboard       <- Yeni ozellik
fix/kap-adapter-crash   <- Hata duzeltme
docs/api-rehberi        <- Dokuman guncellemesi
```

### Commit Mesajlari
```
feat: BIST 30 sirketleri eklendi
fix: KAP adapter timeout hatasi duzeltildi
docs: API rehberi guncellendi
refactor: polling worker temizlendi
test: admin auth testleri eklendi
```

| Onek | Kullanim |
|------|----------|
| `feat:` | Yeni ozellik |
| `fix:` | Hata duzeltme |
| `docs:` | Dokuman degisikligi |
| `refactor:` | Kod duzenlemesi (davranis degismez) |
| `test:` | Test ekleme/duzeltme |
| `perf:` | Performans iyilestirmesi |
| `chore:` | Build/config degisikligi |

### Gunluk Is Akisi
```bash
# 1. Guncel kodu cek
git pull origin master

# 2. Yeni branch olustur
git checkout -b feature/benim-ozelligim

# 3. Kodla + test yaz

# 4. Degisiklikleri kaydet
git add -A
git commit -m "feat: yeni ozellik aciklamasi"

# 5. GitHub'a yukle
git push origin feature/benim-ozelligim

# 6. GitHub'da Pull Request ac
```

---

## Kod Yazma Kurallari

- **Dil:** Kod Ingilizce, aciklamalar/yorumlar Turkce
- **Hata yonetimi:** try/except kullan, hatalari logla
- **Loglama:** `structlog` kullan, `print()` degil
- **Immutability:** Objeleri mutate etme, yeni kopyalar olustur
- **Dosya boyutu:** 200-400 satir tipik, 800 maksimum
- **Test:** TDD yaklasimi — once test yaz, sonra implement et
- **Timestamps:** Her zaman `utcnow()` kullan (`src/core/time.py`)
- **DB:** `ON CONFLICT` upsert kullan, select-then-insert yapma
- **Async:** `asyncio.to_thread()` kullan, `run_in_executor` degil

---

## Test

```bash
# Unit testler
pytest tests/unit/ -v

# Integration testler
pytest tests/integration/ -v

# Tumu
pytest -v

# Coverage
pytest --cov=src tests/
```

Hedef: 80%+ test coverage.

---

## Sik Kullanilan Komutlar

```bash
# Docker
docker-compose up -d          # Baslat
docker-compose down            # Durdur
docker-compose logs -f app     # Backend loglarini izle
docker-compose logs -f worker  # Worker loglarini izle

# Git
git status                     # Ne degisti?
git log --oneline -5           # Son 5 commit

# Veritabani
docker-compose exec app alembic upgrade head    # Migration
docker-compose exec app python scripts/seed.py  # Sirket yukle

# Admin API testi
curl -H "X-Admin-Key: YOUR_KEY" http://localhost:8000/admin/stats
```

---

## Sorun Cozme

| Sorun | Cozum |
|-------|-------|
| `.env not found` | `cp .env.example .env` calistir |
| `port 5432 in use` | Eski PostgreSQL'i kapat: `docker-compose down` |
| `connection refused` | Docker calisiyor mu? `docker ps` ile kontrol et |
| `module not found` | `docker-compose up -d --build` ile yeniden build et |
| `401 Unauthorized` | Admin endpoint icin `X-Admin-Key` header ekle |
| `429 Too Many Requests` | Rate limit asildi, biraz bekle |
