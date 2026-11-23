# Hisse Analizi iOS uygulaması

Expo Router / React Native uygulaması Piyasa, Takip, Tarama ve Takvim sekmelerini içerir.
Yerel başlangıç, bağlantı yönlendirmesi, kurtarma ekranı ve ortak alt panel bu sürümdedir.
Tarama, Makro ve teknik ekranların kapsamı web sürümünden daha dardır.

## Geliştirme ve doğrulama

```bash
npm ci
npm run check
npx expo export --platform ios --output-dir dist
npx expo prebuild --platform ios --no-install
pod install --project-directory=ios
```

API adresi EXPO_PUBLIC_API_URL ile değiştirilebilir. Varsayılan üretim API adresidir.
Minimum iOS sürümü Expo'nun kullandığı sürüme bağlıdır. HTTPS bağlantılarının cihazda
çalışması için AASA ve imzalı uygulamanın Team ID/bundle ID eşleşmesi kurulmalıdır.
TestFlight dağıtımı için imzalı arşiv ve gerçek cihaz kabulü gerekir.

PDF'deki 11. iş olan QR eşleştirme, WidgetKit, yerel hatırlatıcılar ve Siri
next-step dalında geliştirilir.
