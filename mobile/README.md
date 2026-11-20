# Hisse Analizi — iOS Native Uygulama Temeli (`mobile/`)

Web uygulaması `dashboard/` (Next.js), ana iOS uygulaması bu dizindeki Expo Router uygulamasıdır.
Expo SDK 58 / React Native 0.88 sürümleri birlikte sabitlenir; `package-lock.json` sürüm kontrolündedir.
Kökteki `ios/` bağımsız SwiftUI/WidgetKit prototipidir. Ayrı bir üretim uygulaması olarak yayımlanmayacak;
widget, Keychain ve AppIntents kodu Expo uygulamasına extension/native modül olarak aktarılmalıdır.
Bu aktarım henüz yapılmadı; Expo uygulamasında QR eşleştirme ve WidgetKit varmış gibi değerlendirmeyin.

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
```

`EXPO_PUBLIC_API_URL`, doğrudan FastAPI kökü (ör. `http://localhost:8000`) veya web'in `/api`
adresi olabilir. Varsayılan, README'deki üretim adresi `https://hisse-analizi.duckdns.org/api`'dir.
Geliştirme sırasında gerçek iPhone için bilgisayarın ağ adresini kullanın. `localhost` yalnızca
simülatör/bilgisayarın kendisini gösterir. Anahtarlar bu public değişkene konmaz.

`mobile/ios/` Expo prebuild çıktısıdır ve Git'e eklenmez. Kalıcı native değişiklikler `app.json`
ve config plugin'leri üzerinden yapılır. Universal Link'in cihazda çalışması için ilgili sunucuda
Apple App Site Association dosyası ve imzalı uygulamanın Team ID / bundle ID eşleşmesi ayrıca gerekir.
