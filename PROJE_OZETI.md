# BIST Hisse Analizi Platformu — Yönetici Özeti

**Son güncelleme:** 22 Eylül 2026

**Uygulama sürümü:** 1.0.0

**Durum:** Üretime hazır. Uygulama, `docker-compose.prod.yml` ile otomatik HTTPS (Caddy), otomatik veritabanı migration’ı, yedekleme betikleri ve sağlık kontrolleriyle tek komutla yayına alınabilir.

## Ürün ne sunuyor?

Uygulama, Borsa İstanbul paylarını tek bir ekranda izlemek ve analiz etmek için geliştirilmiş bir web platformudur. Anlık piyasa görünümü, hisse fiyat grafikleri, teknik göstergeler, resmi finansal tablolar, analist hedefleri, makroekonomik veriler, KAP açıklamaları, haberler ve hisse tarama araçlarını bir araya getirir.

Hedef kullanıcılar; BIST’i takip eden bireysel yatırımcılar, araştırma ekipleri ve piyasa verisini hızlı biçimde karşılaştırmak isteyen profesyonellerdir. Uygulama yatırım tavsiyesi üretmez; doğrulanabilir veriyi karar desteği formatında sunar.

## Uygulamadaki ana bölümler

| Bölüm | Kullanıcıya sunduğu değer |
|---|---|
| Piyasa Özeti | BIST 100 seviyesi ve gün içi grafik, piyasa genişliği (yükselen/düşen), günün en çok yükselen/düşen hisseleri, endeksler, takip listesi, son KAP gelişmeleri |
| Hisse sayfası | Günlük fiyat ve değişim, grafik, piyasa istatistikleri, son 12 ay finansal oranları, analiz karnesi, KAP bildirimleri, haberler, analist hedefleri, finansal tablolar, temettü |
| Teknik / Temel / Kombine | Aynı hisse sayfasında sekmeler: göstergeler ve dokuz zaman dilimi özeti; şirket profili, değerleme ve ortaklık yapısı; ikisinin karşılaştırması |
| Makro Ekonomi | TCMB politika faizi ve koridor, TÜFE, USD/EUR/GBP kurları, önem ve ülke filtreli ekonomik takvim |
| Hisse Tarama | 600+ işlem gören BIST payı, 15 hazır şablon, gelişmiş filtreler, sıralanabilir tablo, teknik sinyal taraması |
| Olaylar & KAP | Kaynak, kategori, önem, tarih ve hisse filtreli KAP/haber arşivi; sunucu tarafı sayfalama |

## Veri kaynakları ve doğruluk yaklaşımı

| Veri | Birincil kaynak | Uygulamadaki kontrol |
|---|---|---|
| Bilanço, gelir tablosu, nakit akışı | KAP | Sunum birimi her kolon için ayrı okunur ve TL’ye çevrilir; dönem, kümülatif/çeyreklik niteliği ve kaynak gösterilir |
| Finansal oranlar | KAP tabloları | Gelir kalemleri son 4 çeyrek (TTM), bilanço kalemleri dönem sonu; FAVÖK = esas faaliyet kârı + amortisman; hesaplama dönemi ekranda yazar |
| Fiyat, endeks, teknik göstergeler | Borsa İstanbul/TradingView (borsapy) | Değişim önceki kapanışa göre; grafikler gerçek zaman penceresine kırpılır; göstergeler bağımsız hesapla doğrulandı |
| Değerleme çarpanları (F/K, PD/DD) | TradingView | Konsolide ve son 12 ay bazlı; sayfanın tamamında aynı değer kullanılır |
| Tarama ve şirket evreni | İş Yatırım + TradingView (borsapy) | Yalnızca işlem gören BIST payları; şirket adları KAP resmi unvanlarından |
| Politika faizi, döviz, enflasyon | TCMB / TÜİK | Politika faizi TCMB’nin resmi tablosuyla karşılaştırıldı; en güncel dönem tarihe göre seçilir |
| Şirket açıklamaları | KAP | Hisse koduna tam eşleşme; çok şirketli bildirimler her şirkete kaydedilir; önem derecesi kurallarla sınıflandırılır |
| Haberler | Google News RSS | Şirket adıyla eşleştirme, ilgisiz başlıkların elenmesi, tekrarların ayıklanması |

Eksik veri hiçbir ekranda `0` olarak gösterilmez; hata, boş veri ve yükleniyor durumları ayrıdır.

**Veri platformu (1.1.0, `data-infra`):** her veri kümesi kaynağı, çekilme zamanı ve verinin kendi tarihiyle
PostgreSQL'de saklanır; sayfalar depodan servis edilir, depo bayatsa canlı kaynak çekilip depo güncellenir,
kaynak yanıt vermezse son iyi kopya "son kayıtlı veri" uyarısıyla gösterilir. Kotasyon ve barlar TradingView
(15 dk gecikmeli; İş Yatırım resmî kapanışıyla her gün mutabakat), finansal tablolar KAP ilk açıklanan bazında
(İş Yatırım çeyrekleri IAS 29 katsayısıyla KAP bazına çevrilir), makro seriler TCMB/TÜİK tam geçmişiyle depodadır.
Çapraz kaynak kontrolleri her gün çalışır ve `/data/quality` ile izlenir; ölçülen sapmalar
[docs/data-platform.md](./docs/data-platform.md) ve [CHANGELOG.md](./CHANGELOG.md) dosyalarındadır.

## Son kalite kontrolü (22 Eylül 2026)

- 589 otomatik test geçti (6 canlı sağlayıcı testi CI’da atlanır); başlangıçta 88 testti. Kod, yazanlardan bağımsız 8 gözden geçirme ajanıyla ayrıca denetlendi.
- Python lint (ruff) ve tip kontrolü (mypy, 55 dosya) hatasız; başlangıçta 99 tip hatası vardı.
- Frontend ESLint, TypeScript ve Next.js production build başarılı; `npm audit`: 0 açık (Next.js’teki kritik RCE açığı kapatıldı).
- Veritabanı migration’ları sıfırdan kurulum, geri alma ve yeniden kurulumla test edildi; model–şema farkı yok.
- Worker canlı çalıştırıldı: KAP, fiyat, finansal tablo ve haber döngüleri çalışıyor; kapatma sinyalinde 2 saniyede düzgün kapanıyor.
- Tüm sayfalar masaüstü ve mobilde kullanıcı gibi gezildi; konsolda hata yok.
- Örnek doğrulamalar: THYAO 2025/12 toplam varlık 1.996.745 milyon TL ve hasılat 955.472 milyon TL, 2026/03 toplam varlık 2.158.033 milyon TL (KAP ile aynı); THYAO F/K 3,69 (TradingView 3,70); TCMB politika faizi %37,00 (TCMB resmi tablosu ile aynı).

## Yayına alma

1. Sunucuda `.env` dosyasına production değerleri girilir: veritabanı parolası, yönetim anahtarı, alan adı, Let’s Encrypt e-postası, CORS adresi.
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` ile servisler başlatılır; migration’lar otomatik çalışır, sertifika otomatik alınır.
3. Şirket listesi `scripts/seed.py` ile yüklenir; `/health/ready` ve ana sayfalar kontrol edilir.
4. `scripts/backup.sh` günlük çalışacak şekilde zamanlanır.

## Bilinen sınırlar

- Piyasa verileri ücretsiz kaynaklardan geldiği için gecikmeli olabilir (arayüzde belirtilir).
- Kullanıcı hesabı yoktur; platform herkese açık, salt okunur bir analiz ekranıdır. Yönetim işlemleri anahtarla korunur.
- Docker imajları bu geliştirme makinesinde (Docker Hub erişimi olmadığından) derlenemedi; CI her değişiklikte iki imajı da derler.
