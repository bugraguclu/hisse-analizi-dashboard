# 📡 API Kullanım Rehberi — Hisse Takibi

## Başlamadan Önce

API'ye erişmek için Docker çalışıyor olmalı:
```bash
docker-compose up -d
```

API adresi: **http://localhost:8000**
Swagger (interaktif test): **http://localhost:8000/docs**

---

## 1. Şirketler

### Tüm şirketleri listele
```
GET /companies
```
**Ne döner:** 30 BIST şirketi (ticker, isim, borsa bilgisi)

### Tek şirket bilgisi
```
GET /company/{ticker}/info
```
**Örnek:** `GET /company/THYAO/info`
**Ne döner:** Piyasa değeri, sektör, çalışan sayısı, P/E, beta vb.

### Ortaklık yapısı
```
GET /company/{ticker}/holders
```
**Örnek:** `GET /company/AKBNK/holders`
**Ne döner:** Büyük ortaklar ve pay oranları

### Temettü geçmişi
```
GET /company/{ticker}/dividends
```
**Örnek:** `GET /company/EREGL/dividends`
**Ne döner:** Tarih bazlı temettü ödemeleri

---

## 2. Finansal Tablolar

### Tüm tablolar (bilanço + gelir + nakit akışı)
```
GET /financials/{ticker}
GET /financials/{ticker}?quarterly=false   ← yıllık
```
**Örnek:** `GET /financials/THYAO`

### Sadece bilanço
```
GET /financials/{ticker}/balance-sheet
```

### Sadece gelir tablosu
```
GET /financials/{ticker}/income-statement
```

### Sadece nakit akışı
```
GET /financials/{ticker}/cashflow
```

---

## 3. Teknik Göstergeler

### Tüm göstergeler (RSI + MACD + Bollinger + SMA + EMA)
```
GET /technical/{ticker}
```
**Örnek:** `GET /technical/GARAN`

### RSI (Göreceli Güç Endeksi)
```
GET /technical/{ticker}/rsi?period=14
```
- **period**: Hesaplama dönemi (varsayılan: 14)
- RSI > 70 → Aşırı alım (satış sinyali)
- RSI < 30 → Aşırı satım (alış sinyali)

### MACD
```
GET /technical/{ticker}/macd
```
- **value**: MACD çizgisi
- **signal**: Sinyal çizgisi
- **histogram**: MACD - Signal farkı

### Bollinger Bands
```
GET /technical/{ticker}/bollinger?period=20
```
- **value**: Orta bant (SMA)
- **upper_band**: Üst bant
- **lower_band**: Alt bant

### SMA (Basit Hareketli Ortalama)
```
GET /technical/{ticker}/sma?period=50
```

### EMA (Üstel Hareketli Ortalama)
```
GET /technical/{ticker}/ema?period=20
```

---

## 4. Makroekonomik Veriler

### TCMB faiz oranları
```
GET /macro/tcmb
```

### Enflasyon verileri
```
GET /macro/inflation
```

### Politika faiz oranı
```
GET /macro/policy-rate
```

---

## 5. Piyasa Verileri

### Döviz kurları (USD/TRY, EUR/TRY vb.)
```
GET /market/fx
```

### BIST endeksleri
```
GET /market/indices              ← XU100, XU030, XBANK, XUSIN, XHOLD
GET /market/indices/XU100        ← Tek endeks
GET /market/indices/XU100?period=1ay
```

### Ekonomik takvim
```
GET /market/calendar
```

---

## 6. Hisse Tarama (Screener)

```
GET /screener/scan?pe_lt=10&roe_gt=15
```

**Filtreler:**
| Parametre | Açıklama | Örnek |
|-----------|----------|-------|
| `pe_lt` | F/K oranı şundan küçük | `pe_lt=10` |
| `pe_gt` | F/K oranı şundan büyük | `pe_gt=5` |
| `roe_gt` | ROE şundan büyük (%) | `roe_gt=15` |
| `market_cap_gt` | Piyasa değeri şundan büyük | `market_cap_gt=1000000000` |
| `volume_gt` | Hacim şundan büyük | `volume_gt=1000000` |

---

## 7. Haberler ve Olaylar

### Tüm olaylar
```
GET /events?limit=50&offset=0
GET /events?ticker=THYAO          ← Şirkete göre filtre
GET /events?source_code=kap       ← Kaynağa göre filtre
```

### Fiyat verileri
```
GET /prices?ticker=THYAO&interval=1d&limit=30
```

---

## Hata Kodları

| Kod | Anlam |
|-----|-------|
| 200 | Başarılı ✅ |
| 404 | Bulunamadı (yanlış ticker vb.) |
| 422 | Geçersiz parametre |
| 500 | Sunucu hatası (log kontrol et) |
