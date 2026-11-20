# Havuz kod kalitesi incelemesi — 20 Kasım 2026

İncelenen başlangıç: `havuz` @ `99cc6ad`; karşılaştırma tabanı `master` @ `e51cacf`.
Kapsam: 179 dosya, yaklaşık 26 bin ek satır. Bu not bir üretim/sıfır hata garantisi değildir;
statik inceleme, derleme ve aşağıda sınırları belirtilen otomatik doğrulamaların sonucudur.

## Sonuç ve mimari yön

Dal başlangıçta yayına hazır değildi. Testler geçerken QR kodları okunamıyor, Expo derlenemiyor
ve mobil ekranlar backend'de olmayan adresleri çağırıyordu. En önemli hata, yardımcı modüllerin
test edilmesinin çalışan ürünün doğrulanmasıyla eş tutulmasıydı.

Kullanıcının yönlendirmesi doğrultusunda web `dashboard/` (Next.js), ana iOS uygulaması `mobile/`
(Expo Router) olarak devam eder. Kökteki SwiftUI projesi, widget/native davranışlar için referanstır.
İki ayrı iOS uygulaması yayımlamak gereksiz bakım yükü ve URL şeması çakışması yaratır.

## Düzeltilen gerçek sorunlar

1. **QR eşleştirme:** Özel, yaklaşık 400 satırlık QR kodlayıcısının çıktısı ZXing ile çözülemedi.
   `qrcode-generator` ile değiştirildi. Ürün çıktısı bağımsız jsQR testiyle sürüm 1–10, gerçek
   eşleştirme bağlantısı ve UTF-8 metin için okunuyor. ZXing ile ayrıca çapraz kontrol yapıldı.
2. **İstek tekrarları:** Süreç içi `lookup → yazma → record` sırası eşzamanlı isteklerde iki kayıt
   oluşturabiliyordu; restart/worker değişiminde koruma kayboluyordu. `023` migration'ı ve
   `idempotency_receipts` tablosu eklendi. Birincil anahtar ve `INSERT ON CONFLICT` rezervasyonu,
   iş kaydı ve yanıt makbuzu ile aynı transaction içinde commit edilir. Başarısız işlem rezervasyonu
   da geri alır. SQLite üzerinden HTTP davranışı, PostgreSQL üzerinde ayrı eşzamanlı oturumlar test edildi.
3. **Expo derleme ve bağımlılıklar:** JSX içeren `theme.ts`, `.tsx` oldu. Geçersiz
   `expo-status-bar` config plugin kaydı kaldırıldı; eksik notifications bağımlılığı eklendi.
   Yeni mobil temelin SDK 53 bağımlılıkları SDK 58 / RN 0.88 uyumlu sürümlere taşındı; router,
   ref, tema ve TypeScript uyarlamaları yapıldı. Tekrarlanabilir kurulum için lockfile eklendi.
4. **Mobil API sözleşmesi:** Olmayan `/api/v1/market/overview` ve `/api/v1/stocks/...` adresleri
   kaldırıldı. Gerçek `/market/indices`, `/market/snapshot`, `/companies/...`, `/financials/ratios`
   ve `/events` yanıtları ekranlara uyarlandı. Events'in dizi yanıtı ve `WATCH` önem değeri düzeltildi.
   API erişimi README'deki gerçek üretim adresini varsayılan kullanır; ortam değişkeniyle değiştirilebilir.
5. **Yedek geri yükleme:** Son yazma başarısız olduğunda dil/tema önceden uygulanıyordu ve
   metadata geri alınmıyordu. Tercihler ancak yazma başarılı olduktan sonra uygulanır; metadata da
   geri dönüşe dahildir. 5 MiB sınırı UTF-8 baytlarıyla ölçülür; büyük dosya belleğe okunmadan reddedilir.
6. **IndexedDB ve offline:** Yazma hatasında belleğe düşen geri dönüş kopyası, IndexedDB okumaları
   yeniden çalışınca görünmez oluyordu; birleşik okuma düzeltildi. Başarılı yazılarda bellek kopyası
   temizlenerek diğer sekmelerin sildiği kayıtların tekrar görünmesi önlenir. Eski IDB kopyası yeni
   ağ verisini ezemez. Bozuk önbellek satırları ayıklanır; başarılı boş olay yanıtı eski olayları temizler.
7. **iOS güvenli saklama:** Keychain hatasında token'ın UserDefaults'a düz metin yazılması kaldırıldı.
   Güncelleme başarısız olduğunda eski anahtar silinmez; eşleştirme güvenli kayıt başarıyla tamamlanırsa
   etkinleşir. Kayıt başarısızsa yeni sunucu token'ı iptal edilir.
8. **Native yaşam döngüsü:** Hatırlatıcı senkronizasyonları beklerken oluşan yarış giderildi.
   Bağlantı kaldırıldıktan/değiştikten sonra eski ağ yanıtı uygulama snapshot'ını geri getiremez.
9. **Gizlilik manifesti:** Diskte bulunup derleme kaynağına bağlı olmayan `PrivacyInfo.xcprivacy`,
   uygulama ve widget'ın Resources fazlarına eklendi. İki gerçek `.app/.appex` çıktısında da doğrulandı.
10. **Yayın kontrolleri:** Node 20, doğrudan TypeScript çalıştıran test komutlarıyla uyumsuzdu.
    CI ve web Docker tabanı Node 24'e alındı. Mobil tip/test/config/bundle kontrolü ile gerçek Expo
    ve Swift simülatör derlemeleri CI'a eklendi. Yapılandırma kontrolü artık tek başına yayın hazırlığı iddiasında bulunmaz.
11. **Üretim URL'leri:** Varsayılan canonical/sitemap adresi README'deki alan adına uyarlandı;
    HTTP(S) dışı ortam değeri reddedilir. Expo bağlantı ayrıştırıcısı üretim alan adını kabul eder.

## Kaldırılan veya sadeleştirilen gereksiz altyapı

- `mutation-outbox.ts`: Uygulamada çağıranı ve sunucu senkronizasyon uçları olmayan 325 satırlık kuyruk.
- Backend `MutationJournal` ve süreç içi `IdempotencyLedger`: Kullanılmayan sunucu undo modeli
  kaldırıldı; gerçek kullanılan istek koruması kalıcı transaction'a taşındı.
- Tarayıcı `IdempotentRequestTracker`: Üretim çağrılarının hiçbirinin istek ID'si vermediği katman
  kaldırıldı. Yerel liste ekleme aynı doğrudan kontrol ve depolama yoluyla sürer.
- Özel QR aritmetiği: Bakım maliyeti yüksek uygulama, küçük bir kütüphane adaptörüne indirildi.
- Bu kullanılmayan soyutlamaları taklit eden testler kaldırıldı; gerçek HTTP/transaction, bağımsız
  QR okuma, API sözleşmesi ve geri yükleme hatası senaryoları eklendi. Tarayıcıdaki liste geri alma korunur.

## Yayından önce açık kalan işler

- **Expo + WidgetKit entegrasyonu:** Swift widget extension'ı, App Group/Keychain paylaşımı,
  eşleştirme ekranı, takvim hatırlatıcıları ve AppIntents henüz Expo uygulamasına aktarılmadı.
  `/cihazlar` QR akışı Swift prototipini hedefler; Expo için tamamlandı denemez. İki projenin
  bundle ID'leri farklıdır; tek dağıtım ve entitlement modeli kurulmalıdır.
- **Mobil ürün kapsamı:** Expo'daki tarama/makro/teknik ekranları hâlâ temel iskelettir; web ile
  işlev eşitliği yoktur. Derlenebilir olmak, bu ekranların tamamlanmış olduğu anlamına gelmez.
- **Universal Links ve imzalama:** Sunucudaki AASA dosyası, Team ID, provisioning, gerçek cihazda
  Keychain/App Group ve soğuk başlangıç eşleştirme/bildirim testleri yayın öncesi ayrıca gerekir.
- **İçerik tekrarı:** `GUIDE_ENTRIES`, `ATLAS_CONCEPTS` ve içerik manifesti kısmen aynı bilgiyi
  ayrı tutuyor. Yeni içerik eklemeden önce tek kanonik kayıt seçilmeli. `/rehber` bağlantıları mevcut
  olduğu için bu incelemede geçiş planı olmadan silinmedi/yönlendirilmedi.
- **Paket bütçesi:** Web toplam JS yaklaşık 3.00/3.50 MiB, gzip yaklaşık 983 KiB/1.15 MiB;
  bütçe içinde ama yeni ağır bağımlılıklar için alan sınırlı. Bu değer ilk sayfanın indirme ölçümü değildir.

## Doğrulama kaydı

- Backend: `ruff check src tests`, `mypy src` geçti.
- Gerçek PostgreSQL 16 ile backend: **1262 başarılı, 19 atlanan**, hata yok.
  Ağ testleri `SKIP_NETWORK_TESTS=1` ile kapalıydı; sağlayıcıların canlı doğruluğu bu sonuca dahil değildir.
- PostgreSQL migration'ları: `alembic upgrade head → downgrade base → upgrade head` geçti; tek head `023`.
- Web: 130 test, içerik kontrolü, ESLint (0 uyarı), TypeScript, üretim derlemesi ve paket bütçeleri geçti.
  Yeni atlas/endeks/sektör/cihaz sayfaları ve sitemap üretim sunucusunda HTTP kontrolünden geçti.
- QR: jsQR otomatik çözme testi ve ZXing bağımsız çapraz kontrolü geçti.
- Expo: temiz `npm ci`, tip/test kontrolü (21 test), bağımlılık uyumu, config, iOS bundle ve prebuild geçti.
- Expo ana uygulaması: CocoaPods kurulumu ve `xcodebuild` simülatör derlemesi geçti; ana uygulamanın
  gizlilik manifesti derlenmiş bundle'da bulundu. Web/Expo testleri CI'daki Node 24 ile de çalıştırıldı.
- Bağımlılık güvenliği: web üretim bağımlılıklarında bulgu yok; Expo'da yüksek/kritik bulgu yok.
- Swift referans projesi: simülatör derlemesi geçti, 22 paylaşılan test geçti; gizlilik dosyaları bundle'da bulundu.

İmzalı App Store/TestFlight arşivi ve gerçek cihaz kabul testi yapılmadı.

## Devam ilkesi

Yeni genel amaçlı kuyruk, senkronizasyon veya editör katmanı eklemek yerine mevcut kullanıcı
akışlarını tamamlayın. Yeni bir soyutlamanın en az bir gerçek üretim çağıranı, somut hata senaryosu
ve maliyetini karşılayan tekrar kullanımı olmalı. Yayın iddiasını config kontrolüne değil, çalışan
ürün akışına ve ilgili platformun gerçek derlemesine bağlayın.
