# API Kullanim Rehberi — Hisse Analizi Dashboard

## Baslamadan Once

API'ye erismek icin Docker calisiyor olmali:
```bash
cp .env.example .env
# .env icinde ADMIN_API_KEY, CORS_ORIGINS ayarla
docker-compose up -d
docker-compose exec app alembic upgrade head
```

API adresi: **http://localhost:8000**
Swagger (interaktif test): **http://localhost:8000/docs**

---

## Kimlik Dogrulama

Admin endpoint'leri (`/admin/*`) `X-Admin-Key` header gerektirir:

```bash
curl -H "X-Admin-Key: YOUR_SECRET_KEY" http://localhost:8000/admin/stats
```

Development modda (`ADMIN_API_KEY` bos ise) auth atlanir.
Production'da `ADMIN_API_KEY` ortam degiskeni zorunludur.

---

## Rate Limiting

Tum endpoint'ler rate limit ile korunur (varsayilan: 100 istek/dakika).
Limit asildiginda `429 Too Many Requests` doner.

---

## 1. Sirketler

### Tum sirketleri listele
```
GET /companies
```
**Ne doner:** BIST sirketleri (ticker, isim, borsa bilgisi)

---

## 2. Olaylar ve Haberler

### Tum olaylar
```
GET /events?limit=50&offset=0
GET /events?ticker=THYAO          <- Sirkete gore filtre
GET /events?source_code=kap       <- Kaynaga gore filtre
```

### Son olaylar
```
GET /events/latest
```

---

## 3. Fiyat Verileri

### Fiyat gecmisi
```
GET /prices?ticker=THYAO&limit=30
```

### Son fiyat
```
GET /prices/latest?ticker=THYAO
```

---

## 4. Finansal Tablolar (DB'den)

### Tum tablolar
```
GET /financials?ticker=THYAO
```

### Hesaplanmis oranlar
```
GET /financials/ratios?ticker=THYAO
```
**Ne doner:** ROE, ROA, net/gross/EBITDA margin, debt-to-equity, current ratio, net debt/EBITDA

---

## 5. Teknik Gostergeler

### RSI (Goreceli Guc Endeksi)
```
GET /technical/{ticker}/rsi?period=14
```
- RSI > 70 → Asiri alim (satis sinyali)
- RSI < 30 → Asiri satim (alis sinyali)

### MACD
```
GET /technical/{ticker}/macd
```

### Bollinger Bands
```
GET /technical/{ticker}/bollinger?period=20
```

### SMA / EMA
```
GET /technical/{ticker}/sma?period=50
GET /technical/{ticker}/ema?period=20
```

### SuperTrend / Stochastic
```
GET /technical/{ticker}/supertrend
GET /technical/{ticker}/stochastic
```

### Sinyal Ozeti
```
GET /technical/{ticker}/signals
GET /technical/{ticker}/signals/all-timeframes
```

---

## 6. Temel Analiz

```
GET /fundamentals/{ticker}/info           Sirket bilgileri
GET /fundamentals/{ticker}/fast-info      Hizli ozet
GET /fundamentals/{ticker}/balance-sheet  Bilanco
GET /fundamentals/{ticker}/income-statement  Gelir tablosu
GET /fundamentals/{ticker}/cashflow       Nakit akis
GET /fundamentals/{ticker}/dividends      Temettu gecmisi
GET /fundamentals/{ticker}/holders        Buyuk ortaklar
GET /fundamentals/{ticker}/recommendations  Analist tavsiyeleri
GET /fundamentals/{ticker}/price-targets  Hedef fiyatlar
GET /fundamentals/{ticker}/earnings-dates Kazanc tarihleri
```

---

## 7. Makroekonomik Veriler

```
GET /macro/tcmb                TCMB faiz oranlari
GET /macro/policy-rate         Politika faizi
GET /macro/inflation           Enflasyon verileri
GET /macro/fx/{symbol}         Doviz kuru (USDTRY, EURTRY)
GET /macro/calendar            Ekonomik takvim
```

---

## 8. Piyasa Verileri

### Hisse tarama
```
GET  /market/screener              Varsayilan tarama
POST /market/screener              Ozel filtre ile tarama
GET  /market/screener/templates    Hazir sablonlar
```

### Teknik sinyal tarama
```
GET /market/scanner?condition=rsi_oversold
```

### Endeksler
```
GET /market/indices                Tum BIST endeksleri
GET /market/index/{symbol}         Endeks fiyat verisi
GET /market/index/{symbol}/info    Endeks bilgileri
```

### Diger
```
GET /market/search?q=THYAO         Sembol arama
GET /market/companies/all          Tum BIST sirketleri
GET /market/tweets/{ticker}        Hisse tweet'leri
GET /market/snapshot?symbols=THYAO,GARAN  Anlik fiyat
```

---

## 9. Admin (X-Admin-Key gerekli)

```
POST /admin/poll/run-once          Manuel poll tetikleme
POST /admin/backfill               Gecmis veri cekme
POST /admin/notification-rules     Bildirim kurali ekle
POST /admin/notifications/test-send  Test bildirim gonder
GET  /admin/stats                  Sistem istatistikleri
```

---

## Hata Kodlari

| Kod | Anlam |
|-----|-------|
| 200 | Basarili |
| 401 | Kimlik dogrulama gerekli (admin endpoint) |
| 403 | Yetkisiz erisim (yanlis API key) |
| 404 | Bulunamadi (yanlis ticker vb.) |
| 422 | Gecersiz parametre |
| 429 | Rate limit asildi |
| 500 | Sunucu hatasi (log kontrol et) |
