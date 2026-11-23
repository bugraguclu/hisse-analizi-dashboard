# Hisse Analizi — iOS Native Uygulama Temeli (`mobile/`)

Web uygulaması `dashboard/` (Next.js), ana iOS uygulaması bu dizindeki Expo Router uygulamasıdır.
Expo SDK 58 / React Native 0.88 sürümleri birlikte sabitlenir; `package-lock.json` sürüm kontrolündedir.
WidgetKit, Keychain, hatırlatıcılar ve Siri desteği aynı Expo uygulamasına bağlıdır.

- `modules/hisse-companion/ios/`: cihaz token'ını JS'e vermeyen yerel Expo modülü ve ortak Swift modelleri.
- `targets/HisseWidgets/`: WidgetKit arayüzü ve zaman çizelgesi.
- `targets/HisseCompanionIntents.swift`: Siri/Kestirmeler girişleri.
- `plugins/with-companion.cjs`: her prebuild'de tek uygulama + gömülü extension üretir; App Group,
  Keychain grubu, bundle ID ve sürüm numarası iki hedefte aynı sözleşmeden türetilir.
- `app/companion.tsx`: QR/kod eşleştirme, web takip listesi özeti ve takvim hatırlatıcısı ayarları.

Minimum iOS sürümü 17.0'dır. Expo Go bu yerel modülü/extension'ı içermez; development build gerekir.
Ayrı SwiftUI uygulama kabuğu kaldırılmıştır.

TusAnkiM'in Expo Router / React Native mimarisinden uyarlanan iOS native uygulama temeli:

- **Güvenilir başlangıç (`lib/startupCoordinator.ts`, `contexts/AppContext.tsx`, `app/_layout.tsx`):**
  - Süreç çapında tek `StartupCoordinator` örneği; UI timeout durumunda çalışan yerel başlatmayı tekrar tetiklemez.
  - `SplashScreen.preventAutoHideAsync()` + `SPLASH_GRACE_MS` (1500 ms) devri, kurtarılabilir `StartupIssueScreen` ve `AppErrorBoundary`.
  - Yerel çalışma alanı (`lib/storage.ts`) ağa bağımlı olmadan açılır; bozuk kayıtlar varsayılan değerlere toparlanır.
- **Navigasyon iskeleti (`app/_layout.tsx`, `app/(tabs)/*`, `app/stock/[ticker].tsx`, `app/makro.tsx`, `app/search.tsx`):**
  - 4 ana sekme (`Piyasa`, `Takip`, `Tarama`, `Takvim`) + native `card` yığını (`stock/[ticker]`, `makro`) + iOS `formSheet` arama ekranı.
- **Bağlantı yönlendirme (`lib/externalLinking.ts`, `lib/incomingUrl.ts`, `lib/nativeIntent.ts`, `app/+native-intent.tsx`):**
  - `hisseanalizi://...` ve `https://hisseanalizi.com/...` Universal Link ayrıştırma ve doğrulama.
  - `redirectSystemPath` ile Expo Router + `Linking` çift yönlendirme engeli.
  - `IncomingUrlQueue` ile başlangıç bitene kadar gelen bağlantıların sırayla bekletilmesi ve tek kez işlenmesi.
- **Ortak alt panel (`components/BottomSheetModal.tsx`, `components/SwipeDismissSheet.tsx`, `lib/sheetPhysics.ts`):**
  - Çıkış animasyonu bitene kadar mount yaşam döngüsü, iOS `KeyboardAvoidingView`, sürükle/scroll çatışma koruması (`SheetScrollView`, `SheetNoDrag`).

## Doğrulama

```bash
cd mobile
npm ci
npm run check
npx expo install --check
npx expo config --type public
npx expo export --platform ios --output-dir dist
npx expo prebuild --platform ios --no-install
node scripts/check-companion.cjs
pod install --project-directory=ios
xcodebuild -workspace ios/HisseAnalizi.xcworkspace -scheme HisseAnalizi -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

`EXPO_PUBLIC_API_URL`, doğrudan FastAPI kökü (ör. `http://localhost:8000`) veya web'in `/api`
adresi olabilir. Varsayılan, README'deki üretim adresi `https://hisse-analizi.duckdns.org/api`'dir.
Geliştirme sırasında gerçek iPhone için bilgisayarın ağ adresini kullanın. `localhost` yalnızca
simülatör/bilgisayarın kendisini gösterir. Anahtarlar bu public değişkene konmaz.

`mobile/ios/` Expo prebuild çıktısıdır ve Git'e eklenmez. Kalıcı native değişiklikler `app.json`
ve config plugin'leri üzerinden yapılır. Universal Link'in cihazda çalışması için ilgili sunucuda
Apple App Site Association dosyası ve imzalı uygulamanın Team ID / bundle ID eşleşmesi ayrıca gerekir.

## Widget eşleştirmesini deneme

1. Web'de `/cihazlar` sayfasından takip listesini seçin ve kod üretin.
2. iPhone Kamerasıyla QR'ı açın veya uygulamada Takip → iPhone widget ve hatırlatıcılar ekranına kodu girin.
3. Sunucu adresini doğrulayıp Bağlan'a basın. Beklenmeyen sunucuya kendiliğinden bağlanılmaz.
4. Ana ekrana Hisse Analizi widget'ı ekleyin; uygulama ve widget aynı salt okunur Keychain token'ını kullanır.
5. İsteğe bağlı hatırlatıcıları etkinleştirin. İzin, kullanıcı bu anahtarı açınca istenir. Takvim tarihleri
   uygulama açılıp yenilendiğinde yeniden planlanır; uygulama kapalıyken sunucu push'u sağlanmaz.
6. Web'den cihazı kaldırın ve yenileyin: hem widget hem uygulama eski veriyi temizlemelidir.

Yerel Expo takip listesi ile web'in widget listesi ayrı kapsamdır. Widget'tan web listesine dokunmak
`companion` ekranındaki salt okunur web listesini açar; yerel listeyi değiştirmez.

İmzalı gerçek cihazda App Group, Keychain paylaşımı, Siri, kilit ekranı ve bildirim kabul testleri
TestFlight öncesi gerekir. Simülatör derlemesi imzalama/provisioning doğrulaması değildir.
