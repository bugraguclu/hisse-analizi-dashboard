# 📋 Değişiklik Günlüğü (Changelog)

Tüm önemli değişiklikler burada tarih sırasıyla belgelenir.
Format: [Oyun Patch Notes tarzı — her gün ne yapıldı, kim yaptı]

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
