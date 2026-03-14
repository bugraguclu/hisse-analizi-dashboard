# 🏗️ Sistem Mimarisi — Hisse Takibi

## Genel Bakış

Bu proje, BIST 30 hisselerini takip eden, haberleri toplayan, finansal verileri analiz eden ve bildirimler gönderen bir **backend sistemidir**.

```
┌─────────────────────────────────────────────────────┐
│                    KULLANICI                         │
│         (Tarayıcı / Dashboard / API Client)         │
└────────────────────────┬────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────┐
│                  FastAPI (API Katmanı)               │
│                                                      │
│  routers.py          → Temel CRUD endpoint'leri      │
│  routers_extended.py → Finansal, teknik, makro API   │
└────────────┬───────────────────────┬────────────────┘
             │                       │
┌────────────▼──────────┐ ┌─────────▼────────────────┐
│  Services (İş Mantığı)│ │  Workers (Arka Plan)      │
│                       │ │                           │
│  event_service.py     │ │  polling_worker.py        │
│  (veri işleme,        │ │  (dakikada 1 veri çeker)  │
│   dedup, normalize)   │ │                           │
│                       │ │  notification_worker.py   │
│                       │ │  (bildirim gönderir)      │
└────────────┬──────────┘ └─────────┬─────────────────┘
             │                       │
┌────────────▼───────────────────────▼────────────────┐
│              Adapters (Veri Kaynakları)               │
│                                                      │
│  kap.py         → KAP bildirimleri (borsapy + API)   │
│  price.py       → Fiyat verisi (borsapy + yfinance)  │
│  financials.py  → Bilanço, gelir tablosu, temettü    │
│  macro.py       → TCMB, enflasyon, döviz, endeksler  │
│  technical.py   → RSI, MACD, Bollinger, SMA, EMA     │
└────────────┬────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────┐
│              PostgreSQL (Veritabanı)                  │
│                                                      │
│  companies          → 30 BIST şirketi                │
│  sources            → Veri kaynakları (KAP, fiyat)   │
│  raw_events         → Ham veriler                    │
│  normalized_events  → İşlenmiş veriler               │
│  price_data         → Fiyat geçmişi                  │
│  ------- YENİ TABLOLAR (models_extended.py) -------  │
│  company_details    → Şirket detay bilgileri         │
│  financial_stmts    → Bilanço, gelir, nakit akışı    │
│  financial_ratios   → F/K, ROE, ROA hesaplamaları    │
│  dividends          → Temettü geçmişi                │
│  major_holders      → Ortaklık yapısı                │
│  technical_indicators → RSI, MACD değerleri          │
│  macro_indicators   → Enflasyon, faiz oranları       │
│  forex_rates        → Döviz kurları                  │
│  index_data         → BIST endeks verileri           │
│  economic_calendar  → Ekonomik takvim                │
│  screener_snapshots → Tarama sonuçları               │
└─────────────────────────────────────────────────────┘
```

---

## Klasör Yapısı

```
hisse-analizi-dashboard/
├── docs/                    ← 📖 Dokümantasyon (şu an buradasın)
│   ├── mimari.md            ← Sistem mimarisi
│   ├── api-rehberi.md       ← API kullanım kılavuzu
│   ├── yol-haritasi.md      ← Proje yol haritası
│   └── katki-rehberi.md     ← Katkı ve çalışma kuralları
│
├── src/                     ← 🧠 Ana kaynak kodu
│   ├── adapters/            ← Dış veri kaynaklarına bağlantı
│   │   ├── base.py          ← Temel adapter sınıfları (abstract)
│   │   ├── kap.py           ← KAP bildirim çekici
│   │   ├── price.py         ← Fiyat verisi çekici
│   │   ├── financials.py    ← Bilanço, gelir tablosu, temettü
│   │   ├── macro.py         ← TCMB, döviz, endeks, takvim
│   │   └── technical.py     ← RSI, MACD, Bollinger, screener
│   │
│   ├── api/                 ← HTTP endpoint tanımları
│   │   ├── app.py           ← FastAPI uygulaması (ana giriş noktası)
│   │   ├── routers.py       ← Temel endpoint'ler (CRUD)
│   │   └── routers_extended.py ← Yeni endpoint'ler (finans, teknik, makro)
│   │
│   ├── core/                ← Ayarlar ve sabitler
│   │   ├── config.py        ← Ortam değişkenleri (.env)
│   │   ├── enums.py         ← Enum tanımları (SourceKind, Severity vb.)
│   │   └── logging.py       ← Log ayarları
│   │
│   ├── db/                  ← Veritabanı katmanı
│   │   ├── models.py        ← Temel tablo tanımları (Company, Event, Price)
│   │   ├── models_extended.py ← Yeni tablolar (Financial, Macro, Technical)
│   │   ├── repository.py    ← Veritabanı sorguları (CRUD işlemleri)
│   │   └── session.py       ← DB bağlantı yönetimi
│   │
│   ├── services/            ← İş mantığı
│   │   └── event_service.py ← Veri işleme, dedup, normalize
│   │
│   ├── workers/             ← Arka plan görevleri
│   │   ├── polling_worker.py     ← Periyodik veri çekme döngüsü
│   │   └── notification_worker.py ← Bildirim gönderme
│   │
│   ├── parsers/             ← Veri ayrıştırma yardımcıları
│   │   └── helpers.py       ← Hash, tarih, temizleme fonksiyonları
│   │
│   └── schemas/             ← API istek/yanıt şemaları (Pydantic)
│       └── events.py        ← Event, Price şemaları
│
├── scripts/                 ← Yardımcı scriptler
│   └── seed.py              ← BIST 30 şirketlerini DB'ye yükler
│
├── tests/                   ← Testler
├── alembic/                 ← DB migration'ları
├── docker-compose.yml       ← Docker servisleri
├── Dockerfile               ← Uygulama imajı
├── pyproject.toml           ← Python bağımlılıkları
└── .env                     ← Ortam değişkenleri (gizli — Git'te yok)
```

---

## Teknoloji Yığını

| Katman | Teknoloji | Ne İşe Yarar |
|--------|-----------|-------------|
| **Backend** | Python 3.12 + FastAPI | API sunucusu |
| **Veritabanı** | PostgreSQL 16 | Veri depolama |
| **ORM** | SQLAlchemy 2.0 (async) | Python ↔ SQL köprüsü |
| **Migration** | Alembic | DB şema değişiklikleri |
| **Veri Kaynağı** | borsapy, yfinance | Borsa verisi çekme |
| **Konteyner** | Docker + Docker Compose | Her yerde aynı çalışır |
| **Versiyon Kontrolü** | Git + GitHub | Kod takibi |
| **Frontend** *(yakında)* | Next.js | Dashboard arayüzü |

---

## Veri Akışı

```
1. Polling Worker her 30sn'de çalışır
   ↓
2. Her aktif şirket için KAP/fiyat adapter'ını çağırır
   ↓
3. Adapter → borsapy → BIST API'si → ham veri alır
   ↓
4. EventService → veriyi normalize eder, dedup yapar
   ↓
5. Veritabanına kaydeder (raw_events + normalized_events)
   ↓
6. EventOutbox'a yazar (bildirim kuyruğu)
   ↓
7. NotificationWorker → outbox'u okur → e-posta gönderir
```
