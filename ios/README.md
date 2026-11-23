# iOS kaynakları Expo uygulamasına taşındı

Tek iOS uygulaması `../mobile/` altındadır. Ayrı SwiftUI uygulama projesi kaldırıldı.

- Yerel modül ve ortak modeller: `../mobile/modules/hisse-companion/ios/`
- WidgetKit: `../mobile/targets/HisseWidgets/`
- Siri: `../mobile/targets/HisseCompanionIntents.swift`
- Kurulum ve doğrulama: `../mobile/README.md`

`mobile/ios/` yalnızca Expo prebuild çıktısıdır; kalıcı değişiklikler kaynak modül ve config plugin'de yapılır.
