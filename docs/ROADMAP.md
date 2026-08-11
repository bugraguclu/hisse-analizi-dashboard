# Ürün ve Teknik Yol Haritası

**Mevcut sürüm:** `0.8.0`

**Son güncelleme:** 11 Ağustos 2026

Bu belge yönü ve öncelikleri gösterir; kesin teslim tarihi taahhüdü değildir. Tamamlanan sürüm ayrıntıları [CHANGELOG.md](../CHANGELOG.md), mevcut ürün kapsamı [README.md](../README.md) ve yönetim özeti [PROJE_OZETI.md](../PROJE_OZETI.md) içindedir.

## Bugünkü durum

| Alan | Durum | Not |
|---|---|---|
| Canlı BIST piyasa görünümü | Tamamlandı | Endeks, fiyat, snapshot, sembol arama |
| Teknik analiz | Tamamlandı | Göstergeler, hareketli ortalamalar, pivot ve çoklu zaman dilimi |
| Temel analiz | Tamamlandı | Resmî KAP tabloları, oranlar, temettü, ortaklık, analist hedefleri |
| Makro veri | Tamamlandı | TCMB politika/faiz, enflasyon, FX ve takvim |
| Screener/scanner | Tamamlandı | İşlem gören BIST payları ve hazır filtreler |
| Olay/haber pipeline | Tamamlandı | PostgreSQL + worker gerektirir |
| AI raporları | Tamamlandı, isteğe bağlı | Gemini/Anthropic, cache, bütçe sınırı, SSE |
| Veri kalite katmanı | Tamamlandı | Kaynak/dönem metadata’sı, hata görünürlüğü ve regresyon testleri |
| CI ve repo standartları | Tamamlandı | Backend/frontend/Compose GitHub Actions kontrolleri |
| Kullanıcı hesapları/portföy | Planlandı | Takip listesi bugün browser tarafındadır |
| Production gözlemlenebilirliği | Platforma bağlı | Hata izleme, uptime ve merkezi log deployment kararı gerektirir |

## Yakın dönem — `0.9.x`

### 1. Production operasyonları

- [ ] Yönetilen PostgreSQL ve otomatik şifreli yedekleme kuralları
- [ ] Migration için tek seferlik release job
- [ ] Uptime, hata takibi ve dış veri sağlayıcı sağlık metrikleri
- [ ] Worker gecikmesi, outbox derinliği ve veri tazeliği alarmları
- [ ] Secret rotation ve production CORS/TLS kontrol listesi

### 2. Kullanıcı ve portföy deneyimi

- [ ] Güvenli kullanıcı hesabı ve session yönetimi
- [ ] Sunucu taraflı takip listeleri
- [ ] Portföy pozisyonu, maliyet ve kâr/zarar takibi
- [ ] Kullanıcı bazlı bildirim tercihleri
- [ ] Veri dışa aktarma ve hesap silme akışı

### 3. Veri güvenilirliği

- [ ] Her sağlayıcı için son başarılı güncelleme/tazelik göstergesi
- [ ] Birincil/yedek kaynak sapma alarmı
- [ ] Finansal tablo parser fixture kapsamını daha fazla sektörle genişletme
- [ ] Kurumsal aksiyonlar için daha güçlü split/temettü normalizasyonu
- [ ] Haricî kaynak sözleşmesi değişikliklerini yakalayan planlı smoke test

## Orta dönem — `1.0`

### Ölçeklenebilirlik

- [ ] Dağıtık cache ve rate-limit store değerlendirmesi
- [ ] Birden fazla worker replica için yük/yarış testi ve operasyon runbook’u
- [ ] Büyük tarama sonuçlarında cursor pagination
- [ ] Uzun süren işler için görünür job durumu ve tekrar deneme politikası

### Ürün kalitesi

- [ ] Erişilebilirlik denetimi (WCAG 2.2 AA hedefi)
- [ ] Kritik kullanıcı akışları için uçtan uca browser testleri
- [ ] Performans bütçesi ve Core Web Vitals izlemesi
- [ ] Mobil tablo/grafik etkileşimlerinin iyileştirilmesi
- [ ] Veri kaynağı ve hesaplama metodolojisi sayfası

### Analiz deneyimi

- [ ] Sektör/emsal karşılaştırmaları
- [ ] Tarihsel çarpan bantları
- [ ] Portföy düzeyinde risk ve korelasyon görünümü
- [ ] AI raporları için yapılandırılmış kanıt bağlantıları ve kullanıcı geri bildirimi

## Bilinçli olarak kapsam dışı

- Emir iletimi, aracı kurum entegrasyonu ve otomatik alım/satım
- Kesin getiri vaadi veya kişiye özel yatırım tavsiyesi
- Kaynaksız/uydurulmuş piyasa verisi ile boş ekran doldurma
- Sağlayıcı kullanım koşullarını ihlal eden veri toplama yöntemleri

## Yayın kapıları

Bir sürüm “yayına hazır” sayılmadan önce:

1. Backend lint ve tüm testler geçmeli.
2. Frontend lint ve production build geçmeli.
3. Compose sözleşmesi doğrulanmalı.
4. Yeni veri alanları birincil kaynakla karşılaştırılmalı.
5. Loading/error/empty durumları kullanıcı akışında görülmeli.
6. Migration ve geri dönüş etkisi değerlendirilmiş olmalı.
7. Güvenlik, secret ve lisans kontrolleri tamamlanmalı.

Öneri ve kapsam tartışmaları yapılandırılmış GitHub feature request şablonuyla açılabilir.
