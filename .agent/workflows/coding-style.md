---
description: Türkçe, beginner-friendly, açıklama yoğun, temiz Python kodu yazma kuralları
---

# Temiz Kod Yazma Kuralları — Hisse Takibi Projesi

## Genel İlkeler

1. **Her dosyanın başında** dosyanın ne yaptığını anlatan Türkçe bir docstring olmalı
2. **Her fonksiyonun** üstünde ne yaptığını, parametrelerini ve dönüş değerini açıklayan docstring olmalı
3. **Karmaşık satırların** yanında `# açıklama` olmalı
4. **Değişken isimleri** anlamlı ve İngilizce olmalı (Python standartı), ama açıklamalar Türkçe

## Dosya Başlangıcı Şablonu

```python
"""
Modül Adı: [dosya_adi.py]
Ne Yapar: [Bu dosya X verilerini Y kaynağından çeker ve Z formatında döndürür]
Kullanılan Teknolojiler: [borsapy, asyncio, SQLAlchemy vb.]
Bağımlılıklar: [hangi dosyalara bağlı]
"""
```

## Fonksiyon Şablonu

```python
async def fetch_balance_sheet(self, ticker: str, quarterly: bool = True) -> dict | None:
    """
    Bir şirketin bilanço verilerini çeker.

    Bu fonksiyon borsapy kütüphanesini kullanarak KAP'tan
    bilanço verilerini alır ve dict formatında döndürür.

    Parametreler:
        ticker (str): Hisse kodu, örn. "THYAO", "AKBNK"
        quarterly (bool): True ise çeyreklik, False ise yıllık veri

    Döndürür:
        dict | None: Bilanço verileri veya veri yoksa None

    Örnek:
        data = await adapter.fetch_balance_sheet("THYAO")
        # data = {"TotalAssets": 1234567, "TotalLiabilities": 987654, ...}
    """
```

## Satır İçi Açıklama Kuralları

```python
# ✅ İyi — NE YAPTIĞINI ve NEDEN yaptığını açıkla
companies = await company_repo.get_all()  # Veritabanından tüm aktif şirketleri al
await asyncio.sleep(1)  # Rate limiting: API'ye çok sık istek atmamak için 1 saniye bekle

# ❌ Kötü — zaten belli olan şeyi tekrarlama
x = 5  # x'e 5 ata
```

## Import Grupları (sıralama)

```python
# 1. Python standart kütüphaneleri
import asyncio
from datetime import datetime

# 2. Üçüncü parti kütüphaneler
import structlog
from sqlalchemy import select

# 3. Proje içi modüller
from src.adapters.base import BaseAdapter
from src.db.models import Company
```

## Hata Yönetimi Açıklamaları

```python
try:
    # borsapy'den veri çekmeyi dene
    data = await adapter.fetch_prices()
except ConnectionError:
    # İnternet bağlantısı yoksa veya API kapanmışsa buraya düşer
    logger.error("Bağlantı hatası", ticker=self.ticker)
    return []
except Exception as e:
    # Beklenmeyen bir hata olduysa logla ve boş döndür (uygulama çökmesin)
    logger.error("Bilinmeyen hata", error=str(e))
    return []
```

## Önemli Kurallar

- Kod İngilizce, açıklamalar Türkçe
- Her adapter sınıfının başında hangi borsapy modülünü kullandığını belirt
- Karmaşık SQL sorgularının üstüne ne yaptığını yaz
- Magic number kullanma — sabitleri anlamlı isimle tanımla
- `# TODO: açıklama` ile eksik kalan yerleri işaretle
