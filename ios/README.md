# Hisse Analizi · iPhone Uygulaması, Widget'lar, Hatırlatıcılar ve Siri Kestirmeleri

**Mimari durum (20 Kasım 2026):** Ana iOS uygulaması `../mobile/` içindeki Expo uygulamasıdır.
Bu Xcode projesi WidgetKit/AppIntents ve eşleştirme davranışının bağımsız referans prototipidir;
ikinci bir üretim uygulaması değildir. İki uygulama aynı URL şemasını kaydettiğinden birlikte
dağıtılmamalıdır. Widget extension'ı, App Group/Keychain paylaşımı ve QR eşleştirme Expo'ya
aktarılmadan birleşik iOS ürününün hazır olduğu söylenemez.

BIST 100 özeti, seçili takip listesi hisseleri ve yaklaşan finansal takvim olaylarını (bilanço, temettü, TCMB PPK ve ekonomik açıklamalar) iPhone ana ekranı ve kilit ekranına taşır.

## Kapsam

- **Ana ekran ve kilit ekranı widget'ları (WidgetKit):**
  - **BIST Özeti** (`.systemSmall`, `.systemMedium`, `.accessoryCircular`, `.accessoryRectangular`, `.accessoryInline`)
  - **Takip Listesi** (`.systemSmall`, `.systemMedium`, `.accessoryRectangular`)
  - **Yaklaşan Olaylar** (`.systemSmall`, `.systemMedium`, `.accessoryRectangular`, `.accessoryInline`)
  - İnternet bağlantısı yokken son kayıtlı veri, tarih ve `Çevrimdışı` etiketiyle gösterilir.
- **QR ile widget eşleştirme ve cihaz iptali:**
  - Web uygulamasında `/cihazlar` ekranından 10 dakikalık tek kullanımlık 8 karakterlik kod ve QR üretilir.
  - Sunucu yalnızca kodun ve cihaz token'ının SHA-256 özetini saklar; cihaz token'ı `widget:read` salt okunur kapsamıyla sınırlıdır ve iOS'ta Keychain'de tutulur.
  - QR bağlantısı yalnızca varsayılan ya da mevcut bağlı sunucuyla kendiliğinden eşleşir; başka bir adres kullanıcı onayına sunulur.
- **Takvim hatırlatıcıları (`UNUserNotificationCenter`):**
  - Bilanço, nakit temettü ve TCMB / ekonomik açıklamalar öncesinde yerel bildirim planlar (15 dk önce, 1 saat önce veya 1 gün önce 09:00 `Europe/Istanbul`).
  - Olay tarihi değiştiğinde eski bildirim iptal edilip yeni tarihe göre yeniden planlanır; iOS'un 64 bekleyen bildirim sınırı altında en fazla 48 hatırlatıcı tutulur.
  - **Not:** Yerel hatırlatıcılar canlı fiyat eşiği veya anlık KAP push alarmı sağlamaz.
- **Siri ve Kestirmeler (`AppIntents` + `NSUserActivity` / `INUIAddVoiceShortcutViewController`):**
  - “Sabah panomu aç”, “Takip listemi aç”, “THYAO analizini aç” kestirmeleri uygulama kapalıyken de ilgili ekrana yönlendirir; kaldırılmış takip listesi anlaşılır uyarı ile mevcut listeye düşer.

## Derleme ve Test

1. `ios/HisseAnalizi.xcodeproj` dosyasını Xcode 26+ ile açın ve `HisseAnalizi` ile `HisseAnaliziWidget` hedeflerinde kendi geliştirici hesabınızı seçin.
2. Simülatör için derleme:
   ```sh
   xcodebuild -project ios/HisseAnalizi.xcodeproj -scheme HisseAnalizi -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
   ```
3. Simülatörde QR eşleştirme bağlantısı denemesi:
   ```sh
   xcrun simctl openurl booted "hisseanalizi://pair?server=http://127.0.0.1:3000&code=ABCD2345"
   ```
4. Paylaşılan Swift mantık testleri:
   ```sh
   swiftc ios/Shared/WidgetModels.swift ios/Shared/DeepLinkRouter.swift ios/Shared/CalendarReminderModel.swift ios/Tests/verify_shared.swift -o /tmp/hisse-ios-tests && /tmp/hisse-ios-tests
   ```
