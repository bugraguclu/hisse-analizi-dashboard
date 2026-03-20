# Proje Yol Haritasi — Hisse Analizi Dashboard

## Proje Durumu: Faz 3 tamamlandi, Faz 4 (Dashboard UI) basliyor

---

## Tamamlananlar

### Faz 0 — Altyapi (15 Mart 2026)
- [x] Git + GitHub repo kurulumu
- [x] Docker duzeltmeleri (Dockerfile, docker-compose)
- [x] Alembic migration klasoru

### Faz 1 — Mimariyi Anla (15 Mart 2026)
- [x] Tum kaynak dosyalarin analizi
- [x] Mimari rehber dokumani

### Faz 2 — Multi-Stock / BIST 30 (15 Mart 2026)
- [x] 30 BIST sirketi seed'e eklendi
- [x] KAP ve fiyat adapterlari dinamik hale getirildi
- [x] Polling worker tum sirketler icin calisiyor
- [x] API'ye ticker filtresi eklendi

### Faz 2.5 — borsapy Tam Entegrasyon (15 Mart 2026)
- [x] 11 yeni veritabani modeli (finansal, makro, teknik)
- [x] 15 adapter sinifi
- [x] 53+ API endpoint
- [x] Swagger dokumantasyonu otomatik

### Faz 3 — Finansal Analiz & NLP (20 Mart 2026)
- [x] FinancialStatement ve FinancialRatio modelleri
- [x] AnalysisService — 8 finansal oran (ROE, ROA, margin, debt)
- [x] NLP keyword siniflandirma (7 kategori)
- [x] FinancialAdapter (borsapy: bilanco, gelir tablosu, nakit akis)
- [x] Alembic initial migration (13 tablo)
- [x] GET /financials ve GET /financials/ratios endpoint'leri
- [x] Dinamik bildirim subject (hardcoded AEFES kaldirildi)
- [x] Utility scriptleri (backfill_classification, debug_financials)
- [x] Developer Test UI v0.3.0

---

## Backend Son Durum (MVP Hazir)

| Bilesen | Sayi | Durum |
|---------|------|-------|
| API Endpoints | 53 | Aktif |
| Adapterlar | 15 | Aktif |
| DB Tablolari | 13 | Migration hazir |
| Repository | 11 sinif | CRUD + dedup |
| Servisler | 3 | Event, Notification, Analysis |
| Workerlar | 2 | Polling + Notification |
| Unit Test | 42 | Pass |

**Temizlik Notu:** `routers_extended.py` mount edilmemis (dead code). Tum endpoint'ler diger router dosyalarinda mevcut.

---

## Siradaki: Faz 4 — Dashboard UI

### Mimari Karar
- **Teknoloji:** Vanilla JS + Chart.js (CDN) — FastAPI static files icinde
- **Neden:** Ayri frontend sunucu gerektirmez, deploy basit, MVP icin yeterli
- **Sonra:** Gerekirse React/Next.js'e gecis yapilabilir (API hazir)

### Sayfa Yapisi

#### 4.1 — Ana Sayfa (Piyasa Ozeti)
- [x] BIST 100 / BIST 30 endeks karti
- [x] Doviz kurlari (USD, EUR, GBP)
- [x] Politika faizi
- [x] En cok yukselen / dusen hisseler
- [x] Son haberler/olaylar ozeti

#### 4.2 — Hisse Listesi
- [ ] 30 hisse karti (fiyat, degisim, mini sparkline)
- [ ] Arama ve filtreleme
- [ ] Sektore gore gruplama

#### 4.3 — Hisse Detay Sayfasi
- [ ] Fiyat grafigi (Chart.js line/candlestick)
- [ ] Teknik gostergeler (RSI, MACD)
- [ ] Temel analiz ozeti (F/K, PD/DD, ROE)
- [ ] Finansal tablolar (bilanco, gelir)
- [ ] Son haberler/KAP bildirimleri
- [ ] Analist tavsiyeleri

#### 4.4 — Tarama (Screener)
- [ ] Filtre paneli (sektor, fiyat araligi, hacim)
- [ ] Sonuc tablosu
- [ ] Hazir tarama sablonlari

#### 4.5 — Haberler & Olaylar
- [ ] Kronolojik olay akisi
- [ ] Kategori filtreleme (temettu, sermaye artirimi, hukuki vb.)
- [ ] Hisse bazli filtreleme

#### 4.6 — Teknik Analiz
- [ ] Interaktif grafik (zoom, pan)
- [ ] Gosterge overlay (RSI, MACD, Bollinger)
- [ ] Sinyal ozeti tablosu
- [ ] Coklu zaman dilimi karsilastirma

---

## Faz 5 — Gelismis Ozellikler (Sonra)

### 5.1 — AI/NLP Haber Siniflandirma
- [ ] Claude API entegrasyonu
- [ ] Sentiment analizi (pozitif/negatif/notr)
- [ ] Otomatik severity tespiti

### 5.2 — Gercek Zamanli Veri
- [ ] WebSocket canli fiyat push
- [ ] Dashboard auto-refresh

### 5.3 — Bildirim Kanallari
- [ ] Slack entegrasyonu
- [ ] Telegram bot

### 5.4 — Portfoy Takibi
- [ ] Portfoy olusturma
- [ ] Kar/zarar takibi
- [ ] Performans grafikleri

### 5.5 — CI/CD & DevOps
- [ ] GitHub Actions pipeline
- [ ] Otomatik test + deploy
- [ ] Rate limiting

---

## Gorev Dagilimi

| Gorev | Kisi | Branch |
|-------|------|--------|
| Dashboard UI (Frontend) | Ataberk | `feature/dashboard` |
| AI/NLP Entegrasyonu | Bugra | `feature/ai-nlp` |
| Backend gelistirme | Beraber | `master` |

---

## Haftalik Ritual

1. **Pazartesi:** Hedef belirleme (GitHub Issues)
2. **Hafta ici:** Kodlama + ogrenme
3. **Cuma:** Sync call (Bugra ile) + PR review
4. **Hafta sonu:** Opsiyonel calisma + dokuman guncelleme
