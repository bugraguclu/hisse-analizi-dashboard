# BIST Hisse Analizi Platformu — Yönetici Özeti

**Son güncelleme:** 4 Ağustos 2026

**Uygulama sürümü:** 0.8.0

**Durum:** Canlı veri ekranları yayın adayı; olay arşivi ve operasyonel sayaçlar için PostgreSQL ile worker servislerinin deployment ortamında çalışması gerekir.

## Ürün ne sunuyor?

Uygulama, Borsa İstanbul paylarını tek bir ekranda izlemek ve analiz etmek için geliştirilmiş bir web platformudur. Anlık piyasa görünümü, hisse fiyat grafikleri, teknik göstergeler, resmi finansal tablolar, analist hedefleri, makroekonomik veriler, KAP açıklamaları ve hisse tarama araçlarını bir araya getirir.

Hedef kullanıcılar; BIST'i takip eden bireysel yatırımcılar, araştırma ekipleri ve piyasa verisini hızlı biçimde karşılaştırmak isteyen profesyonellerdir. Uygulama yatırım tavsiyesi üretmez; doğrulanabilir veriyi karar desteği formatında sunar.

## Uygulamadaki ana bölümler

| Bölüm | Kullanıcıya sunduğu değer |
|---|---|
| Dashboard | BIST 100 görünümü, endeksler, takip listesi, gün içi OHLC ve hacim |
| Hisse Analizi | Fiyat/hacim grafikleri, canlı oranlar, KAP açıklamaları, analist görüşü, finansal tablolar, temettü ve beklenen finansal rapor tarihleri |
| Teknik Analiz | RSI, MACD, Bollinger, SuperTrend, Stochastic ve dokuz zaman diliminde AL/SAT/NÖTR özeti |
| Temel Analiz | Şirket özeti, piyasa değeri, F/K, PD/DD, 52 hafta aralığı, ortaklık yapısı ve analist hedef fiyatları |
| Kombine Analiz | Teknik ve temel verilerin yan yana karşılaştırılması |
| Makro Ekonomi | TCMB politika/faiz koridoru, TÜFE, USD/EUR/GBP kurları ve ekonomik takvim |
| Hisse Tarama | 599 işlem gören BIST payı, 15 hazır filtre, fiyat/değişim/hacim tablosu ve teknik sinyal taraması |
| Olaylar & KAP | Veritabanında toplanan KAP, haber, yatırımcı ilişkileri ve fiyat olaylarının filtrelenebilir arşivi |

## Veri kaynakları ve doğruluk yaklaşımı

| Veri | Birincil kaynak | Uygulamadaki kontrol |
|---|---|---|
| Bilanço ve gelir tablosu | Resmi KAP şirket finansalları | Sunum birimi gerçek TL'ye çevrilir; dönem ve kaynak ekranda gösterilir |
| Fiyat, endeks ve teknik sinyaller | Borsa İstanbul/TradingView, borsapy üzerinden | Önceki kapanıştan değişim yeniden hesaplanır; anlamsız hacim değerleri elenir |
| Tarama ve şirket evreni | İş Yatırım + TradingView, borsapy üzerinden | Yalnızca işlem gören BIST payları listelenir; global semboller aramaya alınmaz |
| Nakit akışı, temettü ve ortaklık | İş Yatırım, borsapy üzerinden | Alan adları normalize edilir; dönemler yeniden eskiye sıralanır |
| Analist hedefleri | İş Yatırım ve Hedef Fiyat konsensüsü, borsapy üzerinden | Güncel fiyat, düşük/ortalama/medyan/yüksek hedef ve analist sayısı ayrı gösterilir |
| Politika faizi ve döviz | TCMB | Resmi tarih ve kur türü gösterilir; birim bazlı kurlar normalize edilir |
| Enflasyon | TÜİK verisi, TCMB veri tablosu üzerinden | En son dönem tarihe göre seçilir; yıllık ve aylık oran ayrılır |
| Şirket açıklamaları ve takvim | KAP | `GG.AA.YYYY` tarihleri yerel biçimde ayrıştırılır; açıklama bağlantıları doğrudan KAP'a gider |

Sosyal medya alanı, kimlik doğrulaması yapılmış güvenilir bir X/Twitter sağlayıcısı olmadığı için yayın arayüzünden kaldırılmıştır. Boş veya uydurma gönderi gösterilmez.

## Son kalite kontrolü

4 Ağustos 2026 tarihinde THYAO ve BIST örnekleriyle tüm canlı veri sözleşmeleri ve kullanıcı akışları yeniden test edildi:

- 91 backend/unit/integration testi geçti.
- Python lint, frontend ESLint ve TypeScript kontrolleri geçti.
- Next.js production build başarıyla tamamlandı.
- `npm audit --audit-level=high` sonucu: 0 açık.
- Docker Compose yapılandırması geçerli.
- Tarayıcı konsolunda hata veya uyarı görülmedi.
- Hisse arama, hazır filtre, RSI taraması, yıllık/ara dönem finansal tablo sekmeleri ve tüm ana sayfalar kullanıcı gibi çalıştırıldı.
- Örnek doğrulama: THYAO 2025/12 toplam varlıkları 1.996.745 milyon TL, hasılatı 955.472 milyon TL; 2026/03 toplam varlıkları 2.158.033 milyon TL olarak resmi KAP verisiyle eşleşti.

## Yayına alma koşulları

Canlı piyasa, makro, teknik ve temel analiz ekranları dış sağlayıcılardan doğrudan ve kaynak belirterek çalışır. Aşağıdaki servisler ise deployment sırasında birlikte ayağa kaldırılmalıdır:

1. PostgreSQL: olay arşivi, sistem sayaçları, haber sınıflandırmaları ve bildirim kayıtları.
2. Worker: KAP/haber/fiyat verisini periyodik toplama ve normalize etme.
3. FastAPI: veri ve yönetim API'si.
4. Next.js dashboard: kullanıcı arayüzü ve aynı-origin API proxy'si.

Repo bu dört servisi `docker compose` ile tanımlar. İlk yayında migration, seed, production secret'ları, CORS origin'i ve health-check sonuçları doğrulanmalıdır.

## Yönetim açısından sonuç

Ürünün piyasa ve analiz tarafındaki kritik veri hataları giderilmiş, kaynaklar görünür hâle getirilmiş ve yanlış/eksik verinin sessizce `0` veya boş içerik olarak sunulması engellenmiştir. Yayın öncesinde kalan ana operasyonel adım kod değişikliği değil; PostgreSQL ve worker servisleriyle tam deployment ortamının ayağa kaldırılmasıdır.
