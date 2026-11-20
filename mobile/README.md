# Hisse Analizi — iOS Native Uygulama Temeli (`mobile/`)

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
npm test
```
