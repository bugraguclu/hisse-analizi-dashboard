# `havuz` Dalı — AI Devir ve Teknik Bütünleştirme Notu

> **Sonraki kalite incelemesi:** [havuz-kalite-incelemesi.md](./havuz-kalite-incelemesi.md).
> Bu devir notu `99cc6ad` seviyesinin tarihsel kaydıdır. Sonraki düzeltmelerde idempotency
> veritabanına taşındı, kullanılmayan outbox/backend undo altyapısı kaldırıldı, QR kodlayıcı
> değiştirildi ve Expo araç zinciri güncellendi. Ayrı SwiftUI uygulaması kaldırılıp WidgetKit/Siri
> Expo'ya taşındı. Güncel mimari ve doğrulamalar için kalite notunu okuyun.

Bu belge, `havuz` dalını devralacak diğer AI ajanları ve geliştiriciler için yazıldı. Belgede bu dalda **neyin yapıldığı, neden yapıldığı, nasıl birleştirildiği, çakışmaların nasıl çözüldüğü, hangi doğrulamalardan geçtiği ve ileride dikkat edilmesi gereken mimari tuzaklar** eksiksiz biçimde yer alır. Kod ile belge çelişirse kaynak kod doğrudur.

---

## 1. Bağlam ve Amaç (Neden `havuz` Dalı Oluşturuldu?)

Üç referans projenin (**TusAnkiM**, **Yemek Takibi**, **Belif**) kaynak kodları incelenerek `hisse-analizi-dashboard` projesine aktarılacak 25 maddelik geliştirme havuzu çıkarıldı. Bu işlerin bir bölümü **5 paralel Antigravity worktree sohbetinde**, ortak taban commit olan `master` (`e51cacf`) üzerinden ayrı dallarda geliştirildi:

| # | Eski Sohbet / Worktree Adı | Eski Özellik Dalı | Orijinal Commit(ler) | Kapsam |
|---|---|---|---|---|
| 1 | `havuz_yedek_veri_ozet` | `havuz` | `47b63a7` | Kişisel çalışma alanı yedeği + kalıcı çevrimdışı piyasa özeti |
| 2 | `ios_native_uygulama_temeli` | `havuz-klavye-dogrulama-ios` | `8cfbc45`, `e4646f4`, `805653f` | iPhone Safari klavye/form/alt panel + Expo iOS native uygulama temeli + build-öncesi içerik doğrulama manifesti |
| 3 | `proje_karsilastirma_is_havuzu` | `havuz-arama-degisiklik-kontrol` | `8c7c3f6`, `bef9a1e`, `3522afd` | Genişletilmiş arama + güvenilir mutasyonlar (idempotency, çakışma kontrollü geri alma, offline kuyruk) + ortak hata senaryoları & yayın kapıları |
| 4 | `yatirim_kavram_atlasi_ve_web` | `havuz-web` | `6d56a31` | Yatırım kavram atlası (`/atlas`) + kalıcı endeks/sektör sayfaları (`/endeks`, `/sektor`) + açılış kurtarma |
| 5 | `ios_widgets_shortcuts_integration` | `havuz-ios-widgets-shortcuts` | `acd9192` | Native SwiftUI/WidgetKit widget'lar + QR eşleştirme (`/cihazlar`) + yerel takvim hatırlatıcıları + Siri kestirmeleri |

Tüm bu paralel çalışmalar tek bir **`havuz`** dalında birleştirildi, çapraz dal çakışmaları ve CI/yayın kapısı uyumsuzlukları giderildi, ardından boşalan 9 dal (4 özellik dalı + 5 boş taban dalı) ile 5 geçici Antigravity worktree dizini temizlendi.

### Neden `git merge --no-ff` Stratejisi Seçildi?

- **Geçmişin izlenebilirliği:** Rebase veya squash yerine her sohbetin orijinal commit SHA'sı ve mesajı korundu.
- **Güvenli dal temizliği:** Her dal `havuz` içine gerçek atalıkla girdiği için tüm eski dallar `git branch -D` yerine güvenli **`git branch -d`** ile (atalık kanıtı alınarak) silinebildi.
- **İzole çakışma çözümü:** 177+ dosyalık değişimde yalnızca 16 ortak dosya çakışma adayıydı; dal dal birleştirme her birleşim noktasını tek tek incelemeyi sağladı.
- **Ana çalışma dizininin korunması:** Ana çalışma kopyası (`/Users/bugra/hisse-analizi-dashboard`) o sırada `codex/animasyon-revize` dalında commit edilmemiş işler barındırdığından hiçbir aşamada ana çalışma kopyasına dokunulmadı; tüm birleştirme ve doğrulama izole worktree içinde yürütülüp sonunda worktree kaldırıldı. Böylece `havuz` herhangi bir worktree kilidi olmadan doğrudan `git checkout havuz` ile açılabilir durumdadır.

### Commit Grafiği (`master..havuz`)

```text
* <bu-belge> docs(havuz): diğer AI'lar için kapsamlı devir ve bütünleştirme notu ekle
* b8cdbc9    fix(havuz): birleştirme sonrası iOS yayın kapıları ve widget mypy uyumu
* 6bd8cd8    merge: havuz-ios-widgets-shortcuts dalını havuz ile birleştir
|\
| * acd9192  feat(ios): widget'lar, QR eşleştirme, takvim hatırlatıcıları ve Siri kestirmeleri
* de2a33c    merge: havuz-web dalını havuz ile birleştir
|\
| * 6d56a31  feat(web): yatırım kavram atlası, kalıcı endeks/sektör sayfaları ve açılış kurtarması
* 53317ef    merge: havuz-arama-degisiklik-kontrol dalını havuz ile birleştir
|\
| * 3522afd  feat(quality): ortak hata senaryoları, paket boyutu ve native iOS yayın kapıları
| * bef9a1e  feat(mutations): idempotent istek, çakışma kontrollü geri alma ve sınırlı offline kuyruk
| * 8c7c3f6  feat(search): aramayı araç, hazır tarama ve kavram rehberiyle genişlet
* bbe7100    merge: havuz-klavye-dogrulama-ios dalını havuz ile birleştir
|\
| * 805653f  feat(content): build-öncesi içerik doğrulama ve editör önizleme manifesti
| * e4646f4  feat(mobile): iOS native uygulama temeli (navigasyon, başlangıç, alt panel, bağlantı)
| * 8cfbc45  feat(web): iPhone Safari klavye, form ve alt panel davranışları
* 47b63a7    feat(workspace): kişisel çalışma alanı yedeği ve kalıcı çevrimdışı piyasa özeti
```

Toplam fark (`master..havuz`, bu belge hariç): **178 dosya, +26.382 / -283 satır**.

### Silinen Dallar ve Worktree'ler

Aşağıdaki 9 dal `git merge-base --is-ancestor <dal> havuz` doğrulaması sonrası `git branch -d` ile silindi:
- Birleştirilen dallar: `havuz-klavye-dogrulama-ios`, `havuz-arama-degisiklik-kontrol`, `havuz-ios-widgets-shortcuts`, `havuz-web`
- Boş taban dalları (`e51cacf`): `havuz_yedek_veri_ozet`, `ios_native_uygulama_temeli`, `ios_widgets_shortcuts_integration`, `proje_karsilastirma_is_havuzu`, `yatirim_kavram_atlasi_ve_web`
- Kaldırılan geçici worktree dizinleri: `~/.gemini/antigravity/worktrees/hisse-analizi-dashboard/*` (5 adet)

İlgisiz dallara (`master`, `codex/*`, `claude/*`, `animasyon-revize`, `feat/widget-layouts`) **dokunulmadı**.

---

## 2. Dal İçindeki 5 Teknik Paket (Ne Yapıldı ve Nasıl Çalışıyor?)

### Paket 1 — Kişisel Çalışma Alanı Yedeği ve Kalıcı Çevrimdışı Özet (`47b63a7`)

**Kaynak esin:** TusAnkiM (doğrulamalı çalışma alanı yedekleme) + Yemek Takibi (çevrimdışı özet).

- **Temel modüller (`dashboard/src/lib/local-store/`):**
  - `schema.ts`: Yedek formatı `hisse-analizi-workspace`, şema sürümü `1`, güvenlik sınırı **5 MB** (`MAX_BACKUP_BYTES`). Tüm `localStorage` anahtarlarını tek yerde tanımlar ve doğrular:
    - `watchlists`
    - `hisse.dashboard.layout`, `hisse.layout.*`
    - `hisse.chart.index.v2`, `hisse.chart.overview.v2`, `hisse.chart.technical.v2`
    - `hisse.chart.drawings.v1:*`, `hisse.chart.cost.*`
    - `hisse.calendar.countries`, `hisse.marketStrip.paused`, `locale`, `theme`
    - Meta kayıt: `hisse.localStore.meta.v1`
  - `storage.ts`: Güvenli depolama adaptörü + `WORKSPACE_STORAGE_EVENT` (geri yükleme yapıldığında aynı sekmedeki tüm hook ve bileşenleri anında senkronize eder).
  - `idb.ts`: `hisse-analizi-local` (v1, `backups` store) IndexedDB arşivi; SSR, gizli mod veya Node testlerinde otomatik bellek içi fallback kullanır.
  - `backup.ts`: JSON dışa aktarma, içe aktarma öncesi şema/boyut/sürüm doğrulama, **geri yükleme öncesi otomatik `prerestore` geri dönüş kopyası alma**, önizleme üretme ve geri alma.
  - `offline-cache.ts`: BIST endeksleri, takip listesi son fiyatları, makro araçlar, şirket adları ve son KAP bildirimlerinin zaman damgalı yerel kopyası (`buildOfflineWatchlistSnapshot`).
- **Arayüz ve köprü bileşenleri:**
  - `dashboard/src/components/LocalDataBridge.tsx` (`Providers.tsx` içinde mount edilir; çevrimiçi React Query verilerini otomatik çevrimdışı önbelleğe yazar).
  - `dashboard/src/components/workspace/WorkspaceBackupDialog.tsx` (Yedekle/Geri Yükle + Çevrimdışı Özet iki sekmeli modal, `SiteHeader`, `SiteFooter`, `MobileNav` ve `WatchlistCard` içinden `useShell().openWorkspaceManager(...)` ile açılır).
  - `dashboard/src/components/layout/OfflineBanner.tsx` & `dashboard/src/hooks/use-network-status.ts` (`useIsDisconnected`, `useOfflineSummary`; BIST seansı açıkken önbellek bayatlık uyarısı verir).
  - Çevrimdışı fallback eklenen bileşenler: `MarketStrip`, `IndexChartCard`, `LatestEventsCard`, `MarketBreadthCard`, `WatchlistCard`, `DataStatus`.
- **Testler:** `backup.test.ts`, `offline-cache.test.ts`.

---

### Paket 2 — iPhone Safari Klavye/Form, Expo iOS Uygulama Temeli ve İçerik Doğrulama (`8cfbc45`, `e4646f4`, `805653f`)

#### 2A. Web iPhone Safari Klavye, Form ve Alt Panel (`8cfbc45`)
- **Kaynak esin:** Yemek Takibi.
- `dashboard/src/app/layout.tsx`: `viewport.interactiveWidget = "resizes-content"`.
- `dashboard/src/lib/soft-keyboard.ts` + `dashboard/src/components/ui/SoftKeyboardTracker.tsx` (`Providers.tsx` içinde): `visualViewport` ile sanal klavye yüksekliğini ölçer, `html[data-soft-keyboard]` özniteliği ile `--visible-top` / `--visible-height` CSS değişkenlerini günceller ve odaktaki alanın klavye ya da sticky üst/alt çubuk altında kalmaması için `computeRevealDelta` hesabıyla kaydırır.
- `dashboard/src/components/ui/DismissibleSheet.tsx` + `dismissible-sheet.ts`: Sürükleyerek kapatılabilir mobil alt panel; içerideki kaydırılabilir listelerle jest çatışmasını önler (`data-sheet-header`, `data-dismiss-sheet`, `data-sheet-state`).
- Entegrasyon noktaları: `globals.css` (klavye açıkken Sonner toast, `[data-search-overlay]`, `[data-search-listbox]` ve `[data-fb-panel]` yükseklik kısıtları), `TickerSearch.tsx` (`data-keyboard-field`, `data-search-listbox`), `SearchOverlay.tsx`, `filter-bar.tsx`, `ScreenerFilters.tsx`, `EventsToolbar.tsx`, `use-scroll-linked-bar.ts`.
- **Testler:** `soft-keyboard.test.ts`, `dismissible-sheet.test.ts`.

#### 2B. iOS Native Uygulama Temeli — Expo Router / React Native (`e4646f4`, `mobile/`)
- **Kaynak esin:** TusAnkiM.
- **Navigasyon iskeleti (`mobile/app/`):**
  - `_layout.tsx`: `AppErrorBoundary`, `SplashScreen.preventAutoHideAsync()` + `SPLASH_GRACE_MS` (1500 ms) devri, `StartupIssueScreen` kurtarma akışı.
  - 4 ana sekme (`(tabs)/_layout.tsx`): `markets.tsx`, `watchlists.tsx`, `tarama.tsx`, `events.tsx`.
  - Native stack & sheet ekranları: `stock/[ticker].tsx`, `makro.tsx`, `search.tsx` (`formSheet`), `+not-found.tsx`.
- **Başlangıç, depolama ve bağlantı yönlendirme (`mobile/lib/`):**
  - `startupCoordinator.ts` + `contexts/AppContext.tsx`: Süreç çapında tek `StartupCoordinator` örneği; UI timeout durumunda süren yerel başlatmayı iptal etmez veya yeniden başlatmaz.
  - `storage.ts`: Ağa bağımlı olmayan yerel çalışma alanı; bozuk kayıtları varsayılanlara toparlar.
  - `externalLinking.ts`, `incomingUrl.ts`, `nativeIntent.ts`, `app/+native-intent.tsx`: `hisseanalizi://...` ve `https://hisseanalizi.com/...` Universal Link ayrıştırma, ASCII ticker normalizasyonu, `redirectSystemPath` ile çift yönlendirme koruması ve `IncomingUrlQueue` ile başlangıç bitene kadar kuyruklama.
  - `BottomSheetModal.tsx`, `SwipeDismissSheet.tsx`, `sheetPhysics.ts`: Çıkış animasyonu bitene kadar mount yaşam döngüsü, iOS `KeyboardAvoidingView`, sürükle/scroll çatışma koruması.
- **Testler:** `mobile/lib/*.test.ts` (15/15 test).

#### 2C. Build-Öncesi İçerik Doğrulama ve Editör Önizleme Manifesti (`805653f`)
- **Kaynak esin:** Belif.
- `dashboard/content/manifest.json`: Ekranlar (Web + iOS eşlemesi), metrik sözlüğü, rehber yazıları (`published` / `draft` durumlu) için tek kanonik manifest.
- `dashboard/scripts/content-validator.mjs` & `dashboard/scripts/check-content.mjs`: Yayından önce kırık iç bağlantıları, geçersiz metrik/gösterge/kriter/tarama referanslarını, eksik/tutarsız i18n anahtarlarını ve Web/iOS ekran sözleşmelerini doğrular.
- `dashboard/src/lib/content-manifest.ts`: Uygulama içinden tip güvenli manifest erişimi (taslak filtreleme destekli).
- **CI/Build bağlantısı:** `dashboard/package.json` içinde `"prebuild": "npm run check:content"` ve `.github/workflows/ci.yml` içinde `Content & contract check` adımı.
- **Testler:** `content-manifest.test.ts` + `npm run check:content` (8 ekran, 10 metrik, 4 yayında / 1 taslak rehber, 17 gösterge, 22 kriter, 31 hazır tarama, 1708 i18n anahtarı).

---

### Paket 3 — Genişletilmiş Arama, Güvenilir Mutasyonlar ve Yayın Kapıları (`8c7c3f6`, `bef9a1e`, `3522afd`)

#### 3A. Genişletilmiş Arama (`8c7c3f6`)
- **Kaynak esin:** TusAnkiM + Belif.
- `dashboard/src/components/shared/search/catalog.ts`: Hisselerin yanında teknik göstergeleri (`RSI`, `MACD`, `SMA`…), makro bölümleri (`enflasyon`, `politika faizi`…), hazır taramaları (`temettü taraması`, `düşük F/K`…) ve yardım/rehber içeriklerini TR/EN/FR sorgularla (`foldTr`) eşleştirir. Tam ticker eşleşmeleri her zaman en üstte sıralanır.
- `dashboard/src/app/rehber/page.tsx` & `layout.tsx`: Kavram rehberi sayfası (`/rehber`).
- `TickerSearch.tsx`: `scope?: "all" | "stocks"` (`onSelect` verildiğinde yalnızca hisse döndürür; üst menüde birleşik modda çalışır), erişilebilirlik için debounced `aria-live="polite"` sonuç sayımı.
- **Testler:** `catalog.test.ts`.

#### 3B. Güvenilir Kullanıcı Değişiklikleri (`bef9a1e`)
- **Kaynak esin:** Yemek Takibi.
- **Backend (`src/core/mutations.py`, `src/api/routers.py`, `src/api/app.py`):**
  - `Idempotency-Key` başlığı ve `X-Idempotent-Replay: true` yanıt başlığı.
  - Aynı anahtar + aynı yük → çift kayıt oluşturmadan önceki yanıtı döner.
  - Aynı anahtar + farklı yük/kapsam → **HTTP 409** (`code: "request_conflict"`).
  - Revizyon/anlık görüntü kontrollü geri alma yardımcıları → çakışmada **HTTP 409** (`undo_conflict`), süre dolumunda **HTTP 410** (`undo_expired`).
  - `POST /admin/notification-rules` endpoint'i idempotency defterine bağlandı; `dashboard/src/app/api/[...path]/route.ts` `Idempotency-Key` başlığını proxy üzerinden iletir.
- **Frontend (`dashboard/src/lib/reliable-mutations.ts`, `mutation-outbox.ts`, `use-watchlists.ts`, `WatchlistCard.tsx`):**
  - `IdempotentRequestTracker`, `createUndoReceipt`, `evaluateUndo`.
  - `PersonalMutationOutbox`: Sınırlı çevrimdışı kuyruk; ağ gelince tek kez uygular, başka sekmede oturum sahibi (`ownerId`) değiştiyse kuyruktaki işlemi göndermeyi reddeder.
  - `use-watchlists.ts`: Her listeye geriye uyumlu `rev` (varsayılan `1`) eklendi; hisse çıkarma ve liste silme işlemleri Sonner toast üzerinden çakışma kontrollü **Geri Al** (`undoChange`) sunar.
- **Testler:** `reliable-mutations.test.ts`, `tests/unit/test_reliable_mutations.py`.

#### 3C. Ortak Hata Senaryoları, Paket Boyutu ve Native iOS Yayın Kapıları (`3522afd`)
- `tests/fixtures/market_error_scenarios.json`: Python ve TypeScript tarafından ortak okunan 7 kanonik hata/durum senaryosu (`session_open_fresh`, `session_closed_last_close`, `stale_price_provider_down`, `missing_balance_sheet`, `provider_disconnected`, `empty_watchlist`, `dual_device_conflict_and_retry`).
- `dashboard/src/lib/data-meta.ts` (saf mantık `DataMeta.tsx` içinden ayrıştırıldı) + `error-scenarios.test.ts` + `tests/unit/test_market_error_scenarios.py`.
- `scripts/bundle-budgets.config.mjs` & `scripts/check-bundle-budgets.mjs` (`npm run check:budgets`): Üretim JS/CSS/toplam `.next/static` ve gönderilen medya boyut bütçeleri + yasaklı uzantı kontrolü (`.env`, `.pem`, `.key`, `.sqlite`, `.db`, `.p12`, `.mobileprovision`).
- `scripts/ios-release-contract.json` & `scripts/verify-ios-readiness.mjs` (`npm run check:ios`): Hem `mobile/app.json` (Expo) hem `ios/` (native Xcode) hedeflerinde Bundle ID, build number, ATS (`NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=false`), `ITSAppUsesNonExemptEncryption=false`, `PrivacyInfo.xcprivacy`, en az `NSFileProtectionCompleteUntilFirstUserAuthentication` veri koruması (kilit ekranı widget'ları kilitliyken okuyabilsin diye; `NSFileProtectionNone` reddedilir), `associatedDomains` (`applinks:`), `hisseanalizi` URL şeması ve bildirim yapılandırmasını denetler.
- `scripts/release-gates.test.mjs` (`npm run test:gates`) ve `.github/workflows/ci.yml` entegrasyonu.

---

### Paket 4 — Yatırım Kavram Atlası, Kalıcı Endeks/Sektör Sayfaları ve Açılış Kurtarma (`6d56a31`)

**Kaynak esin:** Belif (atlas, kalıcı keşif sayfaları, SEO/JSON-LD) + Yemek Takibi (açılış kurtarma).

- **Yatırım Kavram Atlası (`/atlas`, `/atlas/[slug]`):**
  - `dashboard/src/lib/atlas.ts`: 12 kanonik kavram (`fk-orani`, `ttm-son-12-ay`, `reel-getiri`, `rsi`, `pddd-orani`, `fd-favok`, `roe-ozkaynak-karliligi`, `temettu-verimi`, `banka-ve-sanayi-oranlari`, `sma-kesisimleri`, `sektor-medyani`, `net-borc-favok`), 5 kategori, TR/EN/FR içerik, formül, dikkat noktaları, metodoloji ve doğrudan canlı grafik/tarama/makro/sektör/endeks eylem bağlantıları.
  - Bileşenler: `AtlasHubView.tsx` (native `<details>` akordeon CSS `::details-content` ile), `AtlasConceptView.tsx`.
- **Kalıcı Endeks ve Sektör Sayfaları (`/endeks`, `/endeks/[slug]`, `/sektor`, `/sektor/[slug]`):**
  - `dashboard/src/lib/discovery.ts`: 14 BIST endeksi (`bist-100`…`bist-halka-arz`) + 48 KAP sektörü (alias yönlendirmeleri dahil) için paylaşılabilir kanonik URL kayıt defteri, grup medyanları ve arama (`searchDiscovery`).
  - Bileşenler (`dashboard/src/components/discovery/`): `IndexHubView`, `IndexDetailView`, `SectorHubView`, `SectorDetailView`, `DiscoveryIndexChart`, `DiscoveryStockTable` (`@container (width < 560px)` ile mobil kart dönüşümlü tablo).
  - `MarketStrip.tsx`: Endeks şeridindeki XU030 / XBANK / XUSIN öğeleri artık kendi kanonik `/endeks/[slug]` sayfalarına bağlanır.
- **SEO ve Yapısal Veri:** `dashboard/src/app/sitemap.ts`, `dashboard/src/lib/schema.ts`, `components/shared/JsonLd.tsx`, `components/shared/Breadcrumbs.tsx` (BreadcrumbList, CollectionPage, DefinedTerm, FAQPage; `<` / script kaçışı testli).
- **Açılış Kurtarma (`lib/startup-recovery.ts`, `StartupRecovery.tsx`, `layout.tsx`, `error.tsx`, `global-error.tsx`):**
  - Dağıtım sonrası eski JS/CSS chunk'ında takılan sekmeleri kontrollü kurtarır.
  - `<head>` içindeki inline `<script id="hisse-startup-recovery">` henüz React hidrasyonu bitmeden oluşan chunk/CSS yükleme hatalarını da yakalar.
  - Yalnızca **ilk 30 saniyelik dokunulmamış açılış penceresinde**, çevrimiçi ve görünür sekmede, `sessionStorage` (`hisse.startup.reload`) **60 saniye bekleme kilidi** ile en fazla bir kez otomatik yeniler. Kullanıcı etkileşime geçtiyse veya kilit aktifse asla otomatik yenilemez; `StartupRecovery` banner'ıyla kullanıcıya kontrollü yenileme sunar.
- **Testler:** `atlas.test.ts`, `discovery.test.ts`, `schema.test.ts`, `startup-recovery.test.ts`.

---

### Paket 5 — iOS Widget'lar, QR Eşleştirme, Takvim Hatırlatıcıları ve Siri Kestirmeleri (`acd9192`)

**Kaynak esin:** Yemek Takibi (WidgetKit + QR eşleştirme + cihaz iptali) + TusAnkiM (takvim hatırlatıcıları + Siri kestirmeleri).

- **Veritabanı (`alembic/versions/022_widget_pairing.py`, `src/db/models.py`):**
  - `widget_pairings`: 10 dakikalık tek kullanımlık 8 karakterli kodun SHA-256 özeti (`code_hash`), `owner_hash`, seçili liste/ticker listesi, `expires_at`.
  - `widget_devices`: Eşleştirilmiş cihazlar; `token_hash` (SHA-256), `scope` (`CHECK (scope IN ('widget:read'))` salt okunur), `watchlist_id`, `watchlist_name`, `tickers` (JSONB), `dashboard_id`, `last_seen_at`.
- **Backend API (`src/api/routers_widget.py`, `src/services/widget_service.py`, `src/db/repositories/widget.py`, `src/schemas/widget.py`):**
  - `GET /widget/devices` — Sahibin bağlı cihazlarını listeler (`X-Widget-Owner`).
  - `POST /widget/devices` — Yeni 10 dk geçerli tek kullanımlık eşleştirme kodu üretir.
  - `PATCH /widget/devices/{device_id}` — Bağlı cihazın takip listesini/panosunu günceller.
  - `DELETE /widget/devices/{device_id}` — Cihaz erişimini anında iptal eder.
  - `POST /widget/pair` — Tek kullanımlık kodu tüketip salt okunur `widget:read` cihaz token'ı verir.
  - `GET /widget/summary` — Cihaz Bearer token'ı ile BIST 100 özeti + takip listesi fiyatları + yaklaşan bilanço/temettü/TCMB/ekonomik olayları döner.
  - `DELETE /widget/summary` — Telefonun kendi eşleştirmesini sonlandırmasını sağlar.
- **Web Yönetimi (`/cihazlar`):**
  - `dashboard/src/app/api/widget/[[...path]]/route.ts`: Web tarayıcısı için `X-Widget-Owner` köprüsü.
  - `dashboard/src/app/cihazlar/page.tsx`, `WidgetPairingPanel.tsx`, sıfır bağımlılıklı yerel QR üretici (`dashboard/src/lib/qr.ts`, Version 1–10), `widget-pairing.ts`.
  - `WatchlistCard.tsx` üst çubuğu ve `SiteFooter.tsx` içinden `/cihazlar` bağlantısı.
- **Native iOS SwiftUI + WidgetKit (`ios/`):**
  - `ios/HisseAnalizi.xcodeproj`: `HisseAnalizi` (ana uygulama) ve `HisseAnaliziWidget` (WidgetKit extension) hedefleri.
  - `ios/Widget/HisseWidgets.swift` & `MarketTimelineProvider.swift`: 3 widget ailesi (**BIST Özeti**, **Takip Listesi**, **Yaklaşan Olaylar** — `.systemSmall`, `.systemMedium`, `.accessoryCircular`, `.accessoryRectangular`, `.accessoryInline`), çevrimdışı önbellek ve tarih gösterimi.
  - `ios/App/CalendarReminderManager.swift` & `ios/Shared/CalendarReminderModel.swift`: `UNUserNotificationCenter` ile bilanço/temettü/TCMB/ekonomik olaylar için 15 dk önce / 1 saat önce / 1 gün önce 09:00 (`Europe/Istanbul`) yerel hatırlatıcılar (maks. 48 bildirim, tarih değişince otomatik yeniden planlama).
  - `ios/App/HisseShortcuts.swift` & `ios/Shared/DeepLinkRouter.swift`: `AppIntents` + `NSUserActivity` ile "Sabah panomu aç", "Takip listemi aç", "THYAO analizini aç" kestirmeleri; silinmiş listede zarif fallback.
  - `ios/Shared/SecureStore.swift` & `WidgetAPI.swift`: Keychain + App Group (`group.com.bugraguclu.hisseanalizi`) saklama; QR bağlantısında farklı sunucu adresleri için kullanıcı onayı.
- **Testler:** `tests/unit/test_widget_api.py`, `qr.test.ts`, `widget-pairing.test.ts`, `ios/Tests/verify_shared.swift` (22/22).

---

## 3. Birleştirme Sırasında Çözülen Çakışmalar ve Tasarım Kararları

5 dal arasında toplam **16 dosya** birden fazla dal tarafından değiştirilmişti. Her biri bilinçli olarak şöyle birleştirildi:

1. **`dashboard/src/components/shared/TickerSearch.tsx`** (3 dal: klavye + arama kataloğu + atlas/keşif)
   - `havuz-arama-degisiklik-kontrol` (`searchUnified`: `stock | tool | screen | concept`) ile `havuz-web` (`searchAtlasConcepts` + `searchDiscovery`: `concept | index | sector`) tek `SearchRow` (`SearchKind = SearchResultKind | "index" | "sector"`) tipinde birleştirildi.
   - Sonuç sırası: yerel birleşik sonuçlar (tam ticker her zaman ilk) → sunucu sembol araması fallback'i → Atlas kavramları + BIST endeksleri + KAP sektörleri (en fazla 12 sonuç; aynı `code`'a sahip `concept` girdileri tekilleştirildi).
   - `havuz-klavye-dogrulama-ios`'un `data-keyboard-field=""` ve `data-search-listbox=""` öznitelikleri korundu.
   - `settled` ve `pending` durumu `exploreRows.length > 0` koşulunu da hesaba katacak şekilde güncellendi.

2. **`dashboard/src/lib/i18n.ts`** (4 dal)
   - Tüm dalların çeviri anahtarları birleştirildi (**373 anahtar**, 0 çift anahtar).
   - İki dalda da tanımlanan `search.kind.stock` ve `search.kind.concept` çift tanımları temizlendi (`search.kind.concept` → `Kavram / Concept / Concept`; `search.kind.index` ve `search.kind.sector` aynı gruba alındı).

3. **`dashboard/src/hooks/use-watchlists.ts` & `dashboard/src/components/dashboard/WatchlistCard.tsx`** (3 dal)
   - `use-watchlists.ts`: `WORKSPACE_STORAGE_EVENT` dinleyicisi (`havuz`) ile `rev`, `IdempotentRequestTracker`, `createUndoReceipt`, `evaluateUndo`, `undoChange` (`havuz-arama-degisiklik-kontrol`) birlikte çalışır; eski `localStorage` kayıtlarında `rev` yoksa otomatik `1` kabul edilir.
   - `WatchlistCard.tsx`: Çevrimdışı önbellek rozeti + çalışma alanı yedeği kısayolu (`havuz`), Sonner toast geri alma (`havuz-arama-degisiklik-kontrol`) ve başlık çubuğundaki `/cihazlar` iPhone Widget kısayolu (`havuz-ios-widgets-shortcuts`) eksiksiz korundu.

4. **`dashboard/src/components/layout/` (`AppShell`, `SiteHeader`, `SiteFooter`, `MarketStrip`, `nav.ts`) + `layout.tsx` + `Providers.tsx` + `globals.css`**
   - `Providers.tsx`: `<LocalDataBridge />` ve `<SoftKeyboardTracker />` birlikte mount edilir.
   - `AppShell.tsx`: `<OfflineBanner />`, `<StartupRecovery />` ve `<WorkspaceBackupDialog />` birlikte çalışır.
   - `SiteFooter.tsx`: Keşfet bağlantıları (`/atlas`, `/endeks`, `/sektor`, `/tarama`, `/rehber`) + yasal uyarı + çalışma alanı yedeği modalı + `/cihazlar` bağlantısı birlikte yer alır.
   - `nav.ts`: `SECTION_LABELS` içinde `rehber`, `atlas`, `endeks`, `sektor`, `cihazlar` hepsi tanımlıdır; üst menüde 7 öğe vardır (Atlas öğesi `/atlas`, `/endeks`, `/sektor` altında aktifleşir).
   - `layout.tsx`: `interactiveWidget: "resizes-content"`, `metadataBase: new URL(siteOrigin())` ve `<script id="hisse-startup-recovery">` birlikte yer alır.
   - `globals.css`: Yinelenen `dialog[open]` kuralı tekilleştirildi; hem klavye/alt panel CSS'i hem breadcrumb/atlas accordion/discovery container-query tablo CSS'i korundu.

5. **`dashboard/package.json` & `.github/workflows/ci.yml`**
   - Tüm script'ler birleştirildi: `prebuild`, `check:content`, `test`, `check:budgets`, `check:ios`, `test:gates`.
   - CI frontend işi sırayla `check:content` → `lint --max-warnings=0` → `tsc --noEmit` → `npm test && npm run test:gates` → `npm run build` → `npm run check:budgets && npm run check:ios` çalıştırır.

6. **`src/api/app.py`**
   - `widget_router` eklendi; CORS yapılandırması her iki dalın ihtiyaçlarını birleştirecek şekilde güncellendi:
     - `allow_methods`: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
     - `allow_headers`: `Authorization, Content-Type, X-Admin-Key, X-Widget-Owner, X-Request-ID, Idempotency-Key`
     - `expose_headers`: `X-Request-ID, X-Idempotent-Replay, Retry-After, X-Total-Count, X-Data-Meta`

### Birleştirme Sonrası Uyum Düzeltmesi (`b8cdbc9`) — Neden Gerekti?

Dallar tek başlarına test edilirken yakalanmayan **iki gerçek çapraz dal hatası** birleştirme sonrası tam test koşusunda ortaya çıktı ve `b8cdbc9` commit'i ile giderildi:

1. **iOS yayın kapısı (`npm run check:ios`):**
   - `havuz-arama-degisiklik-kontrol` dalı `scripts/verify-ios-readiness.mjs` yazdığında repoda henüz `mobile/app.json` veya `ios/` yoktu; birleşince her ikisi de denetlendi ve 4 kapı hatası verdi.
   - **Yapılan düzeltmeler:**
     - `mobile/app.json`: `NSAllowsLocalNetworking: false`, `ios.entitlements["com.apple.developer.default-data-protection"] = "NSFileProtectionCompleteUntilFirstUserAuthentication"` (önce `NSFileProtectionComplete` idi; kilitli cihazda widget okuyamadığı için bir kademe gevşetildi), `plugins` içine `"expo-notifications"` eklendi.
     - `ios/Config/App-Info.plist`: `CFBundleIdentifier`, `CFBundleVersion`, `ITSAppUsesNonExemptEncryption=false`, `NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=false`, `NSUserNotificationsUsageDescription` eklendi.
     - `ios/Config/App.entitlements`: `com.apple.developer.default-data-protection = NSFileProtectionComplete` ve `com.apple.developer.associated-domains` (`applinks:hisseanalizi.com`, `applinks:www.hisseanalizi.com`) eklendi.
     - `ios/Config/PrivacyInfo.xcprivacy`: Apple Privacy Manifest dosyası oluşturuldu (`NSPrivacyTracking = false`, `NSPrivacyAccessedAPICategoryUserDefaults` / `1C8F.1`).
     - `scripts/verify-ios-readiness.mjs`: Standart `Info.plist` yanında Xcode'un `Config/App-Info.plist` yapısını da tanıması ve `Widget.entitlements` yerine `App.entitlements` dosyasını seçmesi sağlandı.
2. **Backend `mypy` tip hataları (5 hata):**
   - `src/db/repositories/widget.py` (satır 132 ve 147): SQLAlchemy `Result[Any]` üzerinde `rowcount` erişimi, `src/db/repositories/platform.py` ile tutarlı biçimde `cast(CursorResult[Any], result).rowcount or 0` yapıldı.
   - `src/services/widget_service.py` (satır 201–203): `result.meta` tipi `DataMeta | None` olduğu için `meta is not None` null koruması eklendi.

---

## 4. Doğrulama Sonuçları (`havuz` @ `b8cdbc9`)

Birleştirme sonrası tüm doğrulamalar çalıştırıldı ve **0 hata / 0 uyarı** ile geçti:

| Katman | Komut | Sonuç |
|---|---|---|
| İçerik sözleşmesi | `cd dashboard && npm run check:content` | **OK** (8 ekran, 10 metrik, 4 yayında / 1 taslak rehber, 17 gösterge, 22 kriter, 31 hazır tarama, 1708 i18n anahtarı) |
| Web TypeScript | `cd dashboard && npx tsc --noEmit` | **OK** (0 hata) |
| Web ESLint | `cd dashboard && npm run lint -- --max-warnings=0` | **OK** (0 hata, 0 uyarı) |
| Web birim testleri | `cd dashboard && npm test` | **129/129 geçti** (36 suite) |
| Yayın kapısı testleri | `cd dashboard && npm run test:gates` | **4/4 geçti** |
| Web üretim derlemesi | `cd dashboard && API_URL=http://localhost:8000 npm run build` | **OK** (89 statik sayfa + tüm dinamik rotalar) |
| Paket boyutu bütçesi | `cd dashboard && npm run check:budgets` | **OK** (JS raw 2.98/3.50 MiB %85 · JS gzip 977.9 KiB/1.15 MiB %83 · en büyük chunk 519.9/680 KiB %76 · CSS 133.1/180 KiB %74 · `.next/static` 3.62/4.50 MiB %80) |
| iOS yayın hazırlığı | `cd dashboard && npm run check:ios` | **OK** (`mobile/app.json`, `ios` ikisi de doğrulandı) |
| Backend Lint | `ruff check src tests` | **OK** |
| Backend Tip Kontrolü | `mypy src` | **OK** (96 dosya, 0 hata) |
| Backend Testleri | `SKIP_NETWORK_TESTS=1 pytest -q` | **1165 passed, 113 skipped, 0 failed** |
| Alembic Zinciri | `alembic heads` | Tek doğrusal head: **`022 (head)`** |
| Expo Mobil Testleri | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "mobile/lib/*.test.ts"` | **15/15 geçti** (6 suite) |
| Swift Paylaşılan Testler | `swiftc ios/Shared/WidgetModels.swift ios/Shared/CalendarReminderModel.swift ios/Shared/DeepLinkRouter.swift ios/Tests/verify_shared.swift -o /tmp/t && /tmp/t` | **22/22 geçti** |

---

## 5. Diğer AI'lar İçin Kritik Uyarılar, Tuzaklar ve Bilinçli Eksikler

Bu dal üzerinde devam edecek veya `havuz` dalını `master` / `origin/master` ile birleştirecek AI ajanlarının **mutlaka bilmesi gereken** 8 nokta:

1. **İki ayrı iOS dizini birlikte duruyor (`mobile/` vs `ios/`):**
   - `mobile/` Expo Router / React Native uygulama temeli; `ios/` ise saf SwiftUI + WidgetKit + AppIntents + QR eşleştirme Xcode projesidir.
   - **Dikkat:** İki hedefin bundle ID'leri şu an farklıdır: `mobile/app.json` → `com.hisseanalizi.app`, `ios/HisseAnalizi.xcodeproj` → `com.bugraguclu.hisseanalizi` (URL şeması ikisinde de `hisseanalizi`). İleride tek native uygulama kabuğuna karar verilirken (Expo prebuild + WidgetKit target veya saf SwiftUI uygulaması) bundle ID ve App Group (`group.com.bugraguclu.hisseanalizi`) tekilleştirilmelidir.

2. **`ios/Config/PrivacyInfo.xcprivacy` henüz `project.pbxproj` içine kaynak olarak bağlanmadı:**
   - Dosya diskte ve `verify-ios-readiness.mjs` kapısından geçiyor; ancak Xcode ile gerçek App Store / TestFlight arşivi alınmadan önce `ios/HisseAnalizi.xcodeproj/project.pbxproj` içindeki **Copy Bundle Resources** fazına eklenmeli ve tam `xcodebuild` iOS Simulator derlemesi çalıştırılmalıdır (bu oturumda yalnızca `swiftc` paylaşılan testleri koşuldu).

3. **`havuz` dalı yerel `master` (`e51cacf`) tabanlıdır; `origin/master` (`561458e`) 2 commit ileridedir:**
   - Henüz `havuz` içinde olmayan 2 `origin/master` commit'i:
     - `7f4fb1a` — `fix(workspace): keep save accessible while scrolling` (`dashboard/src/components/workspace/Workspace.tsx`)
     - `561458e` — `feat(calendar): Yemek Takibi tarih seçicisini KAP ve Makro'ya taşı` (`EventsToolbar.tsx`, `DateNavigator.tsx`, yeni `date-picker*`)
   - `havuz` dalını `origin/master` ile birleştirirken özellikle `Workspace.tsx` ve `EventsToolbar.tsx` (`data-keyboard-field` / `DatePicker` etkileşimi) dikkatle birleştirilmelidir. Ayrıca ana çalışma dizininde paralel yürüyen `codex/animasyon-revize` / `feat/widget-layouts` (`/sayfalarim` ve 35 widget düzeni) henüz `master` veya `havuz` içinde değildir.

4. **`/rehber` ve `/atlas` birlikte yaşıyor:**
   - `havuz-arama-degisiklik-kontrol` `/rehber` sayfasını, `havuz-web` ise `/atlas` ve `/atlas/[slug]` (12 kanonik kavram + JSON-LD) sayfalarını getirdi.
   - Şu an ikisi de çalışıyor ve `TickerSearch` içinde kavram koduna göre tekilleştiriliyor. Uzun vadede `/rehber` içeriği `/atlas`'a yönlendirilerek tek kanonik bilgi mimarisi kurulabilir; bunu yaparken `dashboard/content/manifest.json` ve `search/catalog.ts` testlerini birlikte güncellemek gerekir.

5. **Web bundle bütçesinde baş boşluğu daraldı (~%80–85):**
   - `Web JS total (raw)` **2.98 / 3.50 MiB (%85)**, `gzip` **977.9 KiB / 1.15 MiB (%83)**, `.next/static` **3.62 / 4.50 MiB (%80)**.
   - Yeni ağır bir paket eklemek `npm run check:budgets` kapısını kıracaktır. Ağır bileşenlerde `next/dynamic` kullanın veya bilinçli bütçe artışı gerekiyorsa `scripts/bundle-budgets.config.mjs` içindeki ölçüm tarihini ve gerekçeyi güncelleyin.

6. **`src/core/mutations.py` idempotency defteri şu an süreç içi (in-memory):**
   - Tek API sürecinde ve testlerde tam çalışır; ancak çoklu Uvicorn worker veya restart sonrası kalıcı idempotency istenirse Redis veya PostgreSQL tablosuna taşınmalıdır.

7. **Canlı PostgreSQL üzerinde Alembic doğrulaması CI'da yapılmalı:**
   - Yerel ortamda PostgreSQL kapalı olduğu için `alembic heads` (`022`) doğrulandı, ancak `alembic upgrade head && alembic downgrade base && alembic upgrade head` canlı Postgres ile koşulmadı.

8. **25 maddelik karşılaştırma listesinden bilinçli olarak henüz yapılmayan işler:**
   - **İsteğe bağlı kullanıcı hesabı ve cihazlar arası senkronizasyon:** Sunucu taraflı hesap/kimlik doğrulama ve bulut sync API'si henüz geliştirilmedi (yerel yedek, `PersonalMutationOutbox` ve `widget` `owner_hash` altyapısı buna hazırlık niteliğindedir).
   - **Gerçek zamanlı fiyat eşiği ve anlık KAP push alarmı:** `CalendarReminderManager` yalnızca planlı takvim tarihleri için cihaz içi yerel bildirim kurar; canlı fiyat/KAP push alarmı için ayrı sunucu alarm motoru + APNs gerekir.
   - **Tarayıcı içi editör önizleme arayüzü:** `dashboard/content/manifest.json` taslakları ve build-öncesi doğrulamayı destekler, ancak etkileşimli editör/önizleme UI sayfası henüz eklenmedi.

---

## 6. Hızlı Başlangıç (Diğer AI'lar İçin Doğrulama Komutları)

`havuz` dalına geçtikten sonra değişiklik yapmadan önce ve sonra şu komutları çalıştırın:

```bash
# 1. Backend
ruff check src tests
mypy src
SKIP_NETWORK_TESTS=1 pytest -q
alembic heads

# 2. Web + İçerik Sözleşmesi + Yayın Kapıları
cd dashboard
npm run check:content
npm run lint -- --max-warnings=0
npx tsc --noEmit
npm test
npm run test:gates
API_URL=http://localhost:8000 npm run build
npm run check:budgets
npm run check:ios

# 3. Mobil & Swift (repo kökünden)
cd ..
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "mobile/lib/*.test.ts"
swiftc ios/Shared/WidgetModels.swift ios/Shared/CalendarReminderModel.swift ios/Shared/DeepLinkRouter.swift ios/Tests/verify_shared.swift -o /tmp/hisse-ios-tests && /tmp/hisse-ios-tests && rm -f /tmp/hisse-ios-tests
```
