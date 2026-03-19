# Hisse Analizi Dashboard — Proje Ozeti

**Son Guncelleme:** 2026-03-19
**Versiyon:** 0.2.0
**Durum:** Teknik/temel analiz, makro veriler ve piyasa tarama modulleri entegre edildi

---

## 1. YAPILAN ISLER

### Faz 1 — Altyapi ve Polling (Tamamlandi)
- [x] Moduler monolit mimari
- [x] PostgreSQL + SQLAlchemy 2.x async
- [x] 10 tablo modeli + repository katmani
- [x] KAP, Haber, IR, Fiyat adapter'lari
- [x] Event pipeline (raw → normalize → outbox)
- [x] Notification sistemi (e-posta / dry-run)
- [x] Polling + notification worker'lari
- [x] 16 REST endpoint
- [x] 36 unit test

### Faz 2 — borsapy Tam Entegrasyon (Tamamlandi)
- [x] Teknik analiz modulu (RSI, MACD, Bollinger, SMA, EMA, SuperTrend, Stochastic)
- [x] Teknik sinyal ozeti (AL/SAT/NOTR) + tum zaman dilimleri
- [x] Temel analiz modulu (sirket bilgileri, finansallar, temettu, ortaklik)
- [x] Analist tavsiyeleri ve hedef fiyatlar
- [x] Makro ekonomik veriler (TCMB, enflasyon, doviz, ekonomik takvim)
- [x] Hisse tarama (screener) — ozel filtrelerle
- [x] Teknik sinyal tarama (scanner)
- [x] BIST endeks verileri
- [x] Sembol arama (780+ sirket)
- [x] Twitter/X finansal tweet entegrasyonu
- [x] Canli fiyat stream altyapisi (TradingView WebSocket)
- [x] Anlik fiyat snapshot (coklu sembol)
- [x] 4 yeni API router dosyasi, 30+ yeni endpoint

---

## 2. YAPILACAKLAR

### Kisa Vadeli
- [ ] PostgreSQL kurulumu ve baglanti testi
- [ ] `alembic upgrade head` ile tablolari olusturma
- [ ] Yeni moduller icin unit test yazimi
- [ ] End-to-end poll test

### Orta Vadeli
- [ ] Frontend dashboard (React/Next.js)
- [ ] Grafik goruntuleme (TradingView widget veya recharts)
- [ ] Object storage for raw payloads
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Rate limiting on API endpoints

### Uzun Vadeli
- [ ] WebSocket real-time fiyat push
- [ ] Slack/Telegram bildirim kanallari
- [ ] Anomaly detection (fiyat/hacim)
- [ ] Portfoy takibi

---

## 3. MIMARI OZET

```
Tip:     Moduler Monolit + Background Worker
Dil:     Python 3.11+
API:     FastAPI (async)
DB:      PostgreSQL 16 (SQLAlchemy 2.x async)
Deploy:  Docker Compose
Versiyon: 0.2.0
```

### Dizin Yapisi
```
hisse-analizi-dashboard/
├── src/
│   ├── api/
│   │   ├── app.py                    ← FastAPI application
│   │   ├── routers.py                ← Core endpoints (16 adet)
│   │   ├── routers_technical.py      ← Teknik analiz endpoints (9 adet)
│   │   ├── routers_fundamentals.py   ← Temel analiz endpoints (10 adet)
│   │   ├── routers_macro.py          ← Makro ekonomi endpoints (5 adet)
│   │   └── routers_market.py         ← Piyasa verileri endpoints (10 adet)
│   ├── adapters/
│   │   ├── base.py                   ← BaseAdapter, RawEventData, PriceRecord
│   │   ├── kap.py                    ← KAP adapter (borsapy + API yedek)
│   │   ├── anadoluefes_news.py       ← Haber scraper
│   │   ├── anadoluefes_ir.py         ← IR scraper
│   │   ├── price.py                  ← Fiyat adapter (borsapy + yfinance)
│   │   ├── technical.py              ← Teknik analiz (RSI, MACD, Bollinger...)
│   │   ├── fundamentals.py           ← Temel analiz (bilanco, gelir, nakit)
│   │   ├── macro.py                  ← Makro veriler (TCMB, enflasyon, FX)
│   │   ├── screener_adapter.py       ← Hisse tarama
│   │   ├── scanner_adapter.py        ← Teknik sinyal tarama
│   │   ├── index_adapter.py          ← BIST endeksleri
│   │   ├── search_adapter.py         ← Sembol arama
│   │   ├── twitter_adapter.py        ← Twitter/X tweet'ler
│   │   └── stream_adapter.py         ← Canli fiyat stream
│   ├── core/                         ← Config, enums, logging
│   ├── db/                           ← Models, repository, session
│   ├── parsers/                      ← Hash, dedup, date parse
│   ├── schemas/                      ← Pydantic request/response
│   ├── services/                     ← Event, price, notification
│   └── workers/                      ← Polling, notification
├── alembic/                          ← DB migrations
├── tests/                            ← Unit + integration (36 test)
├── scripts/                          ← Seed, manual_poll
└── pyproject.toml
```

---

## 4. API ENDPOINT OZETI

| Grup | Endpoint Sayisi | Aciklama |
|------|----------------|----------|
| Core | 17 | health, events, prices, companies, admin |
| Teknik Analiz | 9 | RSI, MACD, Bollinger, SMA, EMA, SuperTrend, Stochastic, signals |
| Temel Analiz | 10 | info, balance-sheet, income, cashflow, dividends, holders, recommendations |
| Makro Ekonomi | 5 | TCMB, enflasyon, doviz, politika faizi, ekonomik takvim |
| Piyasa | 10 | screener, scanner, indices, search, tweets, snapshot |
| **Toplam** | **51** | |

---

## 5. borsapy ENTEGRASYON MATRISI

| Modul | Adapter | API Endpoint | Durum |
|-------|---------|-------------|-------|
| Ticker.history | price.py | /prices | Aktif (polling) |
| Ticker.news | kap.py | /events | Aktif (polling) |
| Ticker.rsi | technical.py | /technical/{t}/rsi | Aktif (on-demand) |
| Ticker.macd | technical.py | /technical/{t}/macd | Aktif (on-demand) |
| Ticker.bollinger_bands | technical.py | /technical/{t}/bollinger | Aktif (on-demand) |
| Ticker.sma | technical.py | /technical/{t}/sma | Aktif (on-demand) |
| Ticker.ema | technical.py | /technical/{t}/ema | Aktif (on-demand) |
| Ticker.supertrend | technical.py | /technical/{t}/supertrend | Aktif (on-demand) |
| Ticker.stochastic | technical.py | /technical/{t}/stochastic | Aktif (on-demand) |
| Ticker.ta_signals | technical.py | /technical/{t}/signals | Aktif (on-demand) |
| Ticker.ta_signals_all_timeframes | technical.py | /technical/{t}/signals/all-timeframes | Aktif (on-demand) |
| Ticker.info | fundamentals.py | /fundamentals/{t}/info | Aktif (on-demand) |
| Ticker.fast_info | fundamentals.py | /fundamentals/{t}/fast-info | Aktif (on-demand) |
| Ticker.balance_sheet | fundamentals.py | /fundamentals/{t}/balance-sheet | Aktif (on-demand) |
| Ticker.income_stmt | fundamentals.py | /fundamentals/{t}/income-statement | Aktif (on-demand) |
| Ticker.cashflow | fundamentals.py | /fundamentals/{t}/cashflow | Aktif (on-demand) |
| Ticker.dividends | fundamentals.py | /fundamentals/{t}/dividends | Aktif (on-demand) |
| Ticker.major_holders | fundamentals.py | /fundamentals/{t}/holders | Aktif (on-demand) |
| Ticker.recommendations | fundamentals.py | /fundamentals/{t}/recommendations | Aktif (on-demand) |
| Ticker.analyst_price_targets | fundamentals.py | /fundamentals/{t}/price-targets | Aktif (on-demand) |
| Ticker.earnings_dates | fundamentals.py | /fundamentals/{t}/earnings-dates | Aktif (on-demand) |
| Ticker.tweets | twitter_adapter.py | /market/tweets/{t} | Aktif (on-demand) |
| bp.TCMB | macro.py | /macro/tcmb | Aktif (on-demand) |
| bp.policy_rate | macro.py | /macro/policy-rate | Aktif (on-demand) |
| bp.inflation | macro.py | /macro/inflation | Aktif (on-demand) |
| bp.FX | macro.py | /macro/fx/{symbol} | Aktif (on-demand) |
| bp.economic_calendar | macro.py | /macro/calendar | Aktif (on-demand) |
| bp.screen_stocks | screener_adapter.py | /market/screener | Aktif (on-demand) |
| bp.TechnicalScanner | scanner_adapter.py | /market/scanner | Aktif (on-demand) |
| bp.Index | index_adapter.py | /market/index/{s} | Aktif (on-demand) |
| bp.indices | index_adapter.py | /market/indices | Aktif (on-demand) |
| bp.search | search_adapter.py | /market/search | Aktif (on-demand) |
| bp.companies | search_adapter.py | /market/companies/all | Aktif (on-demand) |
| TradingViewStream | stream_adapter.py | (programmatic) | Hazir |

---

## 6. TEKNOLOJI STACK'I

| Kategori | Teknoloji | Versiyon |
|----------|-----------|----------|
| Runtime | Python | 3.11+ |
| Web Framework | FastAPI | 0.110+ |
| ORM | SQLAlchemy | 2.x async |
| DB | PostgreSQL | 16 |
| Veri Kaynagi | borsapy | 0.8.3 (MIT) |
| Yedek Fiyat | yfinance | 0.2.35+ |
| HTTP Client | httpx | 0.27+ |
| HTML Parser | BeautifulSoup4 + lxml | |
| Validation | Pydantic | v2 |
| Logging | structlog | JSON format |
| Container | Docker + Compose | |
