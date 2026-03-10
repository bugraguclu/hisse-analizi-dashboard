# AEFES Listener — Haber & KAP Bildirim Sistemi

AEFES (Anadolu Efes) için kamuya açık kaynaklardan olay/haber/KAP bildirimi/fiyat verisi toplayan, saklayan ve bildirime hazır hale getiren polling tabanlı listener sistemi.

## Mimari

```
                    ┌─────────────────────────────────────────┐
                    │            Polling Worker               │
                    │  ┌──────┐ ┌──────┐ ┌────┐ ┌──────┐    │
                    │  │ KAP  │ │ News │ │ IR │ │Price │    │
                    │  └──┬───┘ └──┬───┘ └─┬──┘ └──┬───┘    │
                    └─────┼────────┼───────┼───────┼─────────┘
                          │        │       │       │
              ┌───────────▼────────▼───────▼───────▼──────────┐
              │              Event Service                     │
              │  raw_events → normalized_events → event_outbox │
              └────────────────────┬───────────────────────────┘
                                   │
              ┌────────────────────▼───────────────────────────┐
              │           Notification Worker                   │
              │  outbox → rules match → notifications (mail)   │
              └────────────────────────────────────────────────┘

              ┌────────────────────────────────────────────────┐
              │              FastAPI (REST API)                 │
              │  /health /events /prices /admin/poll/run-once  │
              └────────────────────────────────────────────────┘
```

**Neden modüler monolit?** MVP fazında karmaşıklığı minimize etmek, tek deploy unit ile yönetilebilirlik sağlamak, ve ileride microservice'e geçiş için yeterli ayrımı sunmak.

## Kaynaklar

| Kaynak | Birincil | Yedek | Poll Interval |
|--------|----------|-------|---------------|
| KAP Bildirimleri | borsapy | KAP SPA API | 30sn |
| Kurumsal Haberler | httpx + BS4 | - | 60sn |
| Yatırımcı İlişkileri | httpx + BS4 | - | 300sn |
| Fiyat Verisi | borsapy | yfinance | 300sn |

**Neden borsapy birincil?** MIT lisanslı, 442+ star, BIST'e özel, İş Yatırım/KAP/TradingView kaynaklı, aktif geliştirme altında.

## Kurulum

### Docker ile (önerilen)

```bash
cp .env.example .env
docker-compose up -d
# Migration
docker-compose exec app alembic upgrade head
# Seed
docker-compose exec app python scripts/seed.py
```

### Local geliştirme

```bash
# PostgreSQL gerekli (16+)
pip install -e ".[dev]"
cp .env.example .env
# .env içinde DATABASE_URL'i düzenle

# Migration
alembic upgrade head

# Seed
python scripts/seed.py

# API başlat
uvicorn src.api.app:app --reload

# Worker başlat (ayrı terminal)
python -m src.workers.run_workers
```

## Kullanım

### Manuel poll
```bash
python scripts/manual_poll.py --source kap
python scripts/manual_poll.py  # tüm kaynaklar
```

### API Endpoint'leri
```
GET  /health
GET  /companies
GET  /events?source_code=kap&limit=50
GET  /events/latest
GET  /prices?ticker=AEFES
GET  /prices/latest?ticker=AEFES
POST /admin/poll/run-once   {"source_code": "kap"}
POST /admin/backfill        {"days": 30}
GET  /admin/stats
```

## Test

```bash
# Unit testler
pytest tests/unit/ -v

# Integration testler (network gerekli)
pytest tests/integration/ -v -m integration

# Tümü
pytest -v
```

## Dry-run vs Gerçek SMTP

- `ENABLE_REAL_EMAIL=false` (varsayılan): Bildirimler log'a yazılır, status=sent
- `ENABLE_REAL_EMAIL=true` + SMTP env vars: Gerçek e-posta gönderilir

## Bilinen Limitler ve Riskler

1. **borsapy** 3rd party kütüphane — aktif ama kırılabilir. Yedek kaynaklar mevcut.
2. **KAP /tr/api/disclosures** resmi public API değil — SPA backend'i, habersiz değişebilir.
3. **KAP** 30sn'den sık poll'lanmamalı — resmi dokümanlar uyarıyor.
4. **Anadolu Efes sitesi** ASP.NET WebForms — PostBack/ViewState değişebilir.
5. **Raw payload** DB'de tutmak büyük hacimde sorun → Faz 2'de object storage.
6. Bu sistem **hukuki/finansal tavsiye aracı değildir**.
7. **yfinance** kişisel kullanım içindir — Yahoo TOS'u kontrol edin.

## Multi-Stock Genişleme Planı

Mevcut mimari multi-stock'a hazır:
- `companies` tablosu zaten birden fazla şirketi destekler
- Her adapter `company_id` ile çalışır
- Yeni şirket eklemek: seed'e yeni company + notification_rules ekleme
- Adapter'lar ticker parametresi alacak şekilde genişletilebilir
