> 23 Kasım yayın seçimi. Bu belge havuz dalının tarihsel kaydıdır.
> PDF’deki 1–10 yayın kapsamındadır. QR, widget, hatırlatıcı ve Siri (11) next-step dalındadır.
> Yayın dalında makbuz migration’ı 023 doğrudan 021 sonrasına bağlanır.

# Havuz kod kalitesi incelemesi — 20–21 Kasım 2026

İncelenen başlangıç: `havuz` @ `99cc6ad`; karşılaştırma tabanı `master` @ `e51cacf`.
Kapsam: 179 dosya, yaklaşık 26 bin ek satır. Bu not bir üretim/sıfır hata garantisi değildir;
statik inceleme, derleme ve aşağıda sınırları belirtilen otomatik doğrulamaların sonucudur.

## Sonuç ve mimari yön

Dal başlangıçta yayına hazır değildi. Testler geçerken QR kodları okunamıyor, Expo derlenemiyor
ve mobil ekranlar backend'de olmayan adresleri çağırıyordu. En önemli hata, yardımcı modüllerin
test edilmesinin çalışan ürünün doğrulanmasıyla eş tutulmasıydı.

Kullanıcının yönlendirmesi doğrultusunda web `dashboard/` (Next.js), ana iOS uygulaması `mobile/`
(Expo Router) olarak devam eder. İkinci turda ayrı SwiftUI uygulama kabuğu kaldırıldı; WidgetKit,
Keychain ve AppIntents kaynakları Expo'ya taşındı. İki ayrı iOS uygulaması yayımlanmaz.

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

## İkinci tur: Expo ve widget entegrasyonu

- Tek uygulama: `mobile/`. Eski SwiftUI App/ContentView/Xcode projesi kaldırıldı.
- Swift ortak modelleri ve Keychain, `mobile/modules/hisse-companion/ios/` yerel Expo modülündedir.
  Salt okunur cihaz token'ı JavaScript'e veya AsyncStorage'a aktarılmaz.
- `mobile/targets/HisseWidgets/` widget kaynaklarını, `targets/HisseCompanionIntents.swift` Siri
  girişlerini tutar. `plugins/with-companion.cjs` prebuild sırasında tek uygulamaya extension'ı gömer.
- Bundle ID, sürüm, App Group ve Keychain grubu Expo ayarlarından türetilir. Uygulama ve extension
  aynı grupları kullanır; minimum iOS 17'dir. Üretilen `mobile/ios/` Git'e eklenmez.
- Takip ekranındaki widget bağlantısı `/companion` ekranını açar. QR bağlantısı sunucu/kodu ekrana
  getirir; bağlantı kurulmadan önce sunucu adresi kullanıcıya gösterilir ve Bağlan onayı alınır.
- Hatırlatıcılar native planlayıcıyla kurulur; bildirim izni yalnızca kullanıcı hatırlatıcıyı açınca
  istenir. Expo Notifications tek notification delegate sahibidir ve bildirim dokunuşlarını ortak
  açılış kuyruğuna taşır. Siri girişleri de soğuk/sıcak açılışta aynı kuyruğa teslim edilir.
- Widget web takip listesi salt okunur companion ekranında açılır; Expo'nun yerel listesiyle karışmaz.
  Eşleştirme kaldırıldığında yerel veri ve planlı hatırlatıcılar temizlenir. Eski ağ yanıtı yeni
  bağlantının verisini ezemez.
- F/K, PD/DD, FD/FAVÖK, TTM, ROE, temettü, RSI ve reel getiri rehber metinleri artık Atlas kaydından
  türetilir. Arama bu kavramları `/atlas/[slug]` adresine götürür; eski rehber ID'leri çalışır.
- Prebuild sözleşme kontrolü tek uygulama/tek extension, aynı erişim grupları, doğru manifest ve
  kaynak kopyalarını doğrular. CI, ayrı Swift prototipi yerine birleşik Expo uygulamasını derler.
- Simülatöre kurulumda bulunan eksik widget `CFBundleExecutable` alanı düzeltildi ve sözleşme
  kontrolüne eklendi. Expo Router'ın eski başlangıç ayarı güncel `anchor` sözleşmesine taşındı.
- SwiftUI kabuğuyla birlikte işlevsiz kalan Swift URL ayrıştırıcısı, origin kontrolü ve çift
  yönlendirme koruması kaldırıldı. Gelen bağlantıyı yalnız Expo doğrular; Swift'te widget'ın
  kullandığı URL üretimi kaldı. Liste ID'sindeki `/`, `?` ve `#` karakterleri güvenli kodlanır.

## Yayından önce açık kalan işler

- **Mobil ürün kapsamı:** Expo'daki tarama/makro/teknik ekranları hâlâ temel iskelettir; web ile
  işlev eşitliği yoktur. Derlenebilir olmak, bu ekranların tamamlanmış olduğu anlamına gelmez.
- **Universal Links ve imzalama:** Sunucudaki AASA dosyası, Team ID, provisioning, gerçek cihazda
  Keychain/App Group ve soğuk başlangıç eşleştirme/bildirim testleri yayın öncesi ayrıca gerekir.
- **İçerik sözleşmesi:** Rehberin örtüşen metinleri tekilleştirildi. İçerik manifesti ayrıca yayın
  ve ekran/metric referans sözleşmesidir; henüz bir editör arayüzü veya CMS değildir.
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
- Expo: temiz `npm ci`, tip/test kontrolü (23 test), bağımlılık uyumu, config, iOS bundle ve prebuild geçti.
- Birleşik Expo uygulaması: CocoaPods yerel HisseCompanion modülünü bağladı; `xcodebuild`
  arm64 simülatör derlemesi tek uygulama + gömülü `HisseWidgets.appex` ile geçti. İki gizlilik
  manifesti ve üç Siri girişinin AppIntents metadata'sı derleme çıktısında bulundu.
  Web/Expo testleri CI'daki Node 24 ile de çalıştırıldı.
- Temiz bir proje kopyasında farklı bundle ID/sürümle prebuild ve companion kontrolü geçti.
- iOS 26.5 simülatöründe uygulama kuruldu ve açıldı. Yerel HTTPS test sunucusuyla QR bağlantısının
  alanları doldurduğu, Bağlan onayından önce istek gitmediği, onay sonrası takip listesi/olayların
  geldiği doğrulandı. Uygulama sonlandırılıp bağlantıyla yeniden açılınca Keychain eşleştirmesi
  korundu. Sunucu erişimi iptal edilince yenileme eski veriyi temizleyip yeniden eşleştirme mesajını
  gösterdi. Son açılışta Metro uygulama hatası/Router uyarısı üretmedi.
  Bu test geçici simülatör ve yerel imzalı derlemeyle yapıldı; canlı sunucuda cihaz kaydı oluşturulmadı.
- Bağımlılık güvenliği: web üretim bağımlılıklarında bulgu yok; Expo'da yüksek/kritik bulgu yok.
- Ortak Swift mantığı: kullanılan widget URL'leri, bildirim planlama ve veri etiketleri için
  14 kontrol geçti. Kaldırılan SwiftUI yönlendirme altyapısını test eden kontroller de kaldırıldı;
  gelen bağlantılar Expo'nun 23 testi içinde doğrulanır. Ayrı referans projesi kaldırıldı.

İmzalı App Store/TestFlight arşivi ve gerçek cihaz kabul testi yapılmadı.

## Devam ilkesi

Yeni genel amaçlı kuyruk, senkronizasyon veya editör katmanı eklemek yerine mevcut kullanıcı
akışlarını tamamlayın. Yeni bir soyutlamanın en az bir gerçek üretim çağıranı, somut hata senaryosu
ve maliyetini karşılayan tekrar kullanımı olmalı. Yayın iddiasını config kontrolüne değil, çalışan
ürün akışına ve ilgili platformun gerçek derlemesine bağlayın.
