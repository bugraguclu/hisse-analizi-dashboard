# 📋 Değişiklik Günlüğü (Changelog)

Tüm önemli değişiklikler burada tarih sırasıyla belgelenir.
Format: [Oyun Patch Notes tarzı — her gün ne yapıldı, kim yaptı]

---

## [v0.4.0] — 20 Mart 2026

**Branch:** `master`

### Yeni Ozellikler
- **Next.js Dashboard:** 7 sayfa (Dashboard, Olaylar, Hisse Detay, Teknik, Temel, Makro, Tarama)
- **Docker Compose:** Dashboard servisi eklendi, tek komutla tum sistem ayaga kalkar
- **shadcn/ui + Recharts:** Modern fintech temali UI, grafikler ve tablolar
- **React Query:** 30sn cache, otomatik refetch

### Degisiklikler
- Proje "AEFES Listener"dan genel BIST analiz platformuna yeniden adlandirildi
- Tum hardcoded `AEFES` default degerleri `THYAO` ile degistirildi
- DB adi `aefes_listener` -> `hisse_analizi` olarak guncellendi
- DB kullanicisi `aefes` -> `hisse` olarak guncellendi
- User-Agent `AEFESListener/1.0` -> `HisseAnalizi/1.0` olarak guncellendi
- Yol haritasi guncellendi (Faz 4 eklendi)

### Istatistikler
- **50 dosya** eklendi (dashboard/)
- **75 referans** guncellendi (AEFES -> THYAO, aefes_listener -> hisse_analizi)
- **7 sayfa** Next.js dashboard
- **53 endpoint** backend (degisiklik yok)

---

## [v0.3.0] — 20 Mart 2026

**Branch:** `master` (feature/ai-financial-assistant merge)

### Yeni Ozellikler
- **Finansal Analiz Sistemi:** FinancialAdapter ile borsapy uzerinden bilanco, gelir tablosu, nakit akis cekme ve DB'ye kaydetme
- **AnalysisService:** 8 finansal oran otomatik hesaplama (ROE, ROA, net/gross/ebitda margin, debt_to_equity, current_ratio, net_debt_ebitda)
- **NLP Siniflandirma:** KAP bildirimlerini keyword bazli kategorilere ayirma (temettu, sermaye artirimi, hukuki, yonetim vb.)
- **Alembic Migration:** 13 tablo icin initial migration dosyasi
- **Yeni Endpoint'ler:** GET /financials, GET /financials/ratios
- **Developer Test UI v0.3.0:** Finansal tablolar bolumu eklendi

### Degisiklikler
| Dosya | Ne Degisti |
|-------|-----------|
| `src/core/enums.py` | EventCategory enum + SourceKind.FINANCIAL_STATEMENTS eklendi |
| `src/db/models.py` | FinancialStatement, FinancialRatio modelleri + NormalizedEvent.category kolonu |
| `src/db/models_extended.py` | Bosaltildi, re-export ile geriye donuk uyumluluk |
| `src/db/repository.py` | FinancialStatementRepository, FinancialRatioRepository eklendi |
| `src/services/event_service.py` | NLP siniflandirma + FinancialService eklendi |
| `src/services/analysis_service.py` | Yeni — 8 finansal oran hesaplama |
| `src/adapters/financial_adapter.py` | Yeni — borsapy finansal tablo adapter |
| `src/workers/polling_worker.py` | financials source destegi (3600sn interval) |
| `src/api/routers.py` | /financials ve /financials/ratios endpoint'leri |
| `src/schemas/events.py` | FinancialStatementOut, FinancialRatioOut, StatsOut guncellendi |
| `scripts/seed.py` | financials source eklendi |
| `alembic/versions/001_full_schema_v1.py` | Yeni — 13 tablo migration |

### Istatistikler
- **9 commit**
- **~800 satir** kod eklendi
- **53 endpoint** (onceki: 51)
- **38 unit test** (onceki: 36)

---

## [v0.2.0] — 15 Mart 2026

**Geliştirici:** Ataberk (Antigravity destekli)
**Branch:** `feature/multi-stock`

### 🆕 Yeni Özellikler
- **BIST 30 Desteği:** Proje artık sadece AEFES yerine 30 hisseyi takip ediyor
- **25+ Yeni API Endpoint:** Finansal tablolar, teknik göstergeler, makro veriler, screener
- **Dinamik Adapter'lar:** KAP ve fiyat adapter'ları artık herhangi bir hisse için çalışıyor
- **Swagger Dökümantasyonu:** http://localhost:8000/docs adresinde interaktif API testi

### 📄 Yeni Dosyalar
| Dosya | Açıklama |
|-------|----------|
| `src/db/models_extended.py` | 11 yeni veritabanı tablosu |
| `src/adapters/financials.py` | Bilanço, gelir tablosu, temettü adapter'ları |
| `src/adapters/macro.py` | TCMB, döviz, endeks, ekonomik takvim |
| `src/adapters/technical.py` | RSI, MACD, Bollinger, SMA, EMA, screener |
| `src/api/routers_extended.py` | Tüm yeni endpoint tanımları |
| `docs/mimari.md` | Sistem mimarisi dokümanı |
| `docs/api-rehberi.md` | API kullanım kılavuzu |
| `docs/yol-haritasi.md` | Proje yol haritası |
| `docs/katki-rehberi.md` | Katkı ve kurulum rehberi |

### 🔧 Değiştirilen Dosyalar
| Dosya | Ne Değişti |
|-------|-----------|
| `scripts/seed.py` | 1 şirket → 30 BIST şirketi |
| `src/adapters/kap.py` | Hardcoded AEFES → dinamik `ticker` parametresi |
| `src/adapters/price.py` | Hardcoded AEFES → dinamik `ticker` + yfinance `.IS` |
| `src/workers/polling_worker.py` | Tek şirket → tüm şirketler döngüsü + rate limiting |
| `src/api/routers.py` | Events endpoint'ine `?ticker=` filtresi eklendi |
| `src/db/repository.py` | Ticker ile company join sorgusu eklendi |
| `src/api/app.py` | v0.2.0, 6 yeni router grubu kayıtlı |

### 📊 İstatistikler
- **3 commit:** `2f0ae85`, `95a97a9`, `aa9a0bc`, `1043cad`
- **~1.500 satır** kod ve doküman eklendi
- **30 şirket** veritabanına yüklendi

---

## [v0.1.0] — 14 Mart 2026 (Buğra ile oturum)

**Geliştiriciler:** Ataberk + Buğra
**Branch:** `master`

### 🆕 Proje Oluşturuldu
- FastAPI backend yapısı kuruldu
- PostgreSQL + Docker Compose altyapısı
- KAP bildirimleri ve fiyat verisi çekme (sadece AEFES)
- Bildirim sistemi (outbox pattern)
- Temel API endpoint'leri

### 📄 Teknik Dokümanlar (Drive'da)
- `HisseTakibi_Teknik_Mimari.docx`
- `HisseTakibi_Fizibilite_SWOT_Rekabet.docx`
- `HisseTakibi_Yol_Haritasi.xlsx`

---

<!--
ŞABLON: Yeni gün çalışması eklerken bunu kopyala ve üste yapıştır:

## [vX.X.X] — GG Ay YYYY

**Geliştirici:** İsim
**Branch:** `feature/xxx`

### 🆕 Yeni Özellikler
- 

### 🔧 Değişiklikler
- 

### 🐛 Hata Düzeltmeleri
- 

### 📊 İstatistikler
- **X commit**
- **X satır** eklendi
-->
