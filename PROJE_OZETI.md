# AI Powered Financial Assistant — Proje Özeti

**Son Güncelleme:** 20 Mart 2026
**Faz:** 1 (Tamamlandı) + 2 (Devam Ediyor)
**Durum:** Altyapı BIST 30 ölçeğine genişletildi. Finansal analiz ve NLP sınıflandırma modülleri eklendi. Proje ismi "AI Powered Financial Assistant" olarak güncellendi.

---

## 1. YAPILAN İŞLER (Tamamlanan)

### Altyapı & Yeniden Markalama (Rebranding)
- [x] Projenin adı **"AI Powered Financial Assistant"** olarak tüm dosyalarda (README, API, pyproject.toml vb.) güncellendi.
- [x] Dockerfile'a `psycopg2-binary` eklendi (Kalıcı veritabanı sürücüsü).
- [x] `pyproject.toml`'da `structlog` versiyonu pinlendi.
- [x] `docker-compose.yml` güncellendi:
    - Obsolete `version` attribute kaldırıldı.
    - Veritabanı adı `financial_assistant`, kullanıcı adı `assistant` olarak değiştirildi.
- [x] **Alembic Migration Sistemi:**
    - `initial tables` migration'ı oluşturuldu.
    - `financial_statements` tablosu eklendi.
    - `financial_ratios` tablosu eklendi.
    - `normalized_events` tablosuna `category` (Enum) sütunu eklendi.
- [x] `scripts/reset_polling.py` ile hata alan polling durumlarını sıfırlama aracı eklendi.

### Multi-Stock & BIST 30 Genişlemesi
- [x] **Kapsam Artırımı:** Sistem artık sadece AEFES değil, tüm **BIST 30** şirketlerini destekliyor.
- [x] **Seed Verisi:** `scripts/seed.py` güncellenerek 30+ şirket ve bildirim kuralları otomatik yüklenir hale getirildi.
- [x] **Dinamik Adapterlar:** KAP, Fiyat ve IR adapter'ları `ticker` parametresi alacak şekilde refaktör edildi.
- [x] **Polling Worker:** Tüm aktif şirketleri sırayla tarayan döngüsel yapıya geçildi.
- [x] API endpoint'lerindeki varsayılan "AEFES" kısıtı kaldırıldı, `ticker` parametresi zorunlu ve dinamik hale getirildi.

### Finansal Analiz Modülü
- [x] **FinancialAdapter:** borsapy entegrasyonu ile Bilanço, Gelir Tablosu ve Nakit Akış verilerinin çekilmesi sağlandı.
- [x] **AnalysisService:** Finansal verilerden rasyo hesaplama motoru eklendi:
    - **ROE** (Özsermaye Karlılığı)
    - **ROA** (Aktif Karlılık)
    - **Net Kar Marjı**
    - **Cari Oran**
- [x] **Otomatik Analiz:** Finansal tablolar sisteme girdiği anda oranlar otomatik hesaplanıp `financial_ratios` tablosuna kaydediliyor.

### NLP & Akıllı Sınıflandırma
- [x] **Keyword Classifier:** KAP bildirimlerini ve haberleri analiz eden ilk aşama NLP mantığı kuruldu.
- [x] **Kategorizasyon:** Olaylar; *Temettü, Sermaye Artırımı, Yeni İş, Dava/Ceza, Yönetim Değişimi, Finansal Sonuç* olarak etiketleniyor.
- [x] **Backfill classification:** `scripts/backfill_classification.py` ile mevcut 500+ olay yeni mantığa göre geriye dönük sınıflandırıldı.

### API & Geliştirmeler
- [x] `GET /financials?ticker=THYAO` ile finansal tablo sorgulama.
- [x] `GET /admin/stats` ile yeni tabloları (finansal kayıtlar, oranlar) içeren genişletilmiş istatistikler.
- [x] Bildirim başlıkları dinamik hale getirildi (örn: `[THYAO][KAP] Yeni olay...`).

---

## 2. YAPILACAKLAR (TO-DO)

### Kısa Vadeli (Faz 2 Devamı)
- [ ] **Gelişmiş NLP:** Claude/OpenAI API entegrasyonu ile gerçek sentiment analizi ve özetleme.
- [ ] **Frontend Dashboard:** Next.js + Tailwind + Shadcn/UI ile yatırımcı arayüzü.
- [ ] **Rate Limiting:** API güvenliği için istek sınırlama.
- [ ] **Object Storage:** Ham JSON payload'ların S3 (MinIO) üzerinde saklanması.

### Orta Vadeli (Faz 3)
- [ ] **Yatırım Tez Takibi:** Kullanıcının girdiği tezlerin (örn: "X şirketi kapasite artıracak") haberlerle doğrulanması.
- [ ] **Event Study:** Önemli olayların hisse fiyatı üzerindeki etkisinin tarihsel analizi.
- [ ] **Alarm Önceliklendirme:** AI skoru ile "kritik" haberlerin anlık push/mail olarak ayrılması.

---

## 3. TEKNİK MİMARİ NOTLARI

- **Async/Await:** Tüm I/O işlemleri ve DB sorguları async (SQLAlchemy + FastAPI).
- **Outbox Pattern:** Bildirimlerin veri kaybı olmadan güvenli gönderimi.
- **Graceful Fallback:** borsapy verisi eksikse yfinance veya direkt API denemesi.
- **Dockerized:** Tek komutla (`docker-compose up`) tüm stack (DB, App, Worker) ayağa kalkar.

## 8. BİLİNEN RİSKLER

1. **borsapy** 3rd party — aktif ama breaking change riski var. Yedek kaynaklar yazıldı.
2. **KAP SPA API** resmi değil — habersiz değişebilir. borsapy birincil tutuldu.
4. **Anadolu Efes site** ASP.NET WebForms — yapı değişebilir.
5. **Raw payload** DB'de tutulur — büyük hacimde Faz 2'de object storage'a taşınmalı.
6. **Hukuki uyarı** — sistem finansal tavsiye aracı değildir.
7. **yfinance** — kişisel kullanım, Yahoo TOS kontrol edilmeli.

---

## 9. DOSYA LİSTESİ

```
financial-assistant/
├── PROJE_OZETI.md              ← Bu dosya
├── README.md                   ← Kurulum ve kullanım
├── pyproject.toml              ← Bağımlılıklar
├── .env.example                ← Ortam değişkenleri
├── alembic.ini                 ← Alembic config
├── Dockerfile                  ← Container image
├── docker-compose.yml          ← Orchestration
├── alembic/
│   ├── env.py                  ← Migration env
│   ├── script.py.mako          ← Migration template
│   └── versions/               ← Migration dosyaları
├── scripts/
│   ├── seed.py                 ← Başlangıç verisi
│   └── manual_poll.py          ← Manuel poll aracı
├── src/
│   ├── __init__.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── app.py              ← FastAPI application
│   │   └── routers.py          ← API endpoints (16 adet)
│   ├── adapters/
│   │   ├── __init__.py
│   │   ├── base.py             ← BaseAdapter, RawEventData, PriceRecord
│   │   ├── kap.py              ← KAP adapter (borsapy + API yedek)
│   │   ├── anadoluefes_news.py ← Haber scraper
│   │   ├── anadoluefes_ir.py   ← IR scraper
│   │   └── price.py            ← Fiyat adapter (borsapy + yfinance)
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py           ← Pydantic Settings
│   │   ├── enums.py            ← EventType, Severity, vb.
│   │   └── logging.py          ← structlog setup
│   ├── db/
│   │   ├── __init__.py
│   │   ├── models.py           ← 10 SQLAlchemy model
│   │   ├── repository.py       ← CRUD katmanı
│   │   └── session.py          ← DB session factory
│   ├── parsers/
│   │   ├── __init__.py
│   │   └── helpers.py          ← Hash, dedup, date parse
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── events.py           ← Pydantic schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── event_service.py    ← Raw → Normalize → Outbox
│   │   └── notification_service.py ← Outbox → Rules → Email
│   └── workers/
│       ├── __init__.py
│       ├── polling_worker.py   ← Polling loop + backoff
│       ├── notification_worker.py ← Bildirim loop
│       └── run_workers.py      ← Worker entrypoint
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── fixtures/
    │   ├── borsapy_kap_news.json      ← Gerçek KAP verisi
    │   ├── borsapy_price_data.json    ← Gerçek fiyat verisi
    │   ├── borsapy_companies.json     ← Şirket listesi (30+)
    │   └── anadoluefes_news_page.html ← Gerçek sayfa HTML'i
    ├── unit/
    │   ├── __init__.py
    │   ├── test_helpers.py     ← 24 test
    │   ├── test_enums.py       ← 5 test
    │   └── test_adapters.py    ← 4 test
    └── integration/
        ├── __init__.py
        └── test_borsapy_live.py ← 4 test (network)
```

**Toplam:** 37 dosya, 36 unit test (tümü geçti), 4 integration test şablonu

---

## 10. ÇALIŞTIRMA ADIMLARI

### Ön Gereksinimler
- Python 3.11+
- PostgreSQL 16+ (veya Docker)

### Adımlar
1. `cp .env.example .env` → DATABASE_URL'i düzenle
2. `pip install -e ".[dev]"` → Bağımlılıkları kur
3. PostgreSQL'de `financial_assistant` veritabanını oluştur
4. `alembic revision --autogenerate -m "initial"` → Migration oluştur
5. `alembic upgrade head` → Tabloları oluştur
6. `python scripts/seed.py` → Seed verisi yükle
7. `uvicorn src.api.app:app --reload` → API başlat
8. Ayrı terminalde: `python -m src.workers.run_workers` → Worker başlat
9. `http://localhost:8000/health` → Kontrol et
10. `http://localhost:8000/admin/stats` → İstatistikleri gör
