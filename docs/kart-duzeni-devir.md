# Kart düzeni: taşı, boyutlandır, kaydet — devir notu

Bu not, aynı özelliği başka bir projede kuracak bir AI için yazıldı. Kaynak proje bir borsa analiz paneli (`hisse-analizi-dashboard`, `animasyon-revize` dalı). Notta özelliğin ne yaptığı, nasıl kurulduğu, kararların nedeni, düştüğümüz hatalar ve taşırken değiştirmen gerekenler var. Motorun kaynak dosyaları notun sonundaki ekte eksiksiz duruyor; açıklamalarla kod çelişirse kod doğrudur.

Hedef projenin kart bileşenleri, tasarım sistemi ve sayfa yapısı farklı olacak. Motoru (ek A–E) neredeyse olduğu gibi alabilirsin; sayfaya bağlama ve kartların boyuta uyması (bölüm 7 ve 9) hedef projeye göre yeniden yapılacak iştir.

## 1. Özellik ne yapıyor

Shopify Analytics panosundaki kart düzenleme davranışı örnek alındı.

- Sayfanın başlığında bir **Özelleştir** düğmesi var. Basılınca sayfa düzenleme kipine geçer; düğmenin yerine **Varsayılana dön / İptal / Kaydet** gelir.
- Düzenleme kipinde her kartın üst kenarının ortasında küçük bir hap durur: solunda taşıma tutamacı, sağında seçenek menüsü. Sağ alt köşede boyutlandırma tutamacı vardır.
- Kart tutamacından sürüklenir. Kart imleci izler; diğer kartlar yer açar; kartın bırakılınca oturacağı yer kesik çizgili bir çerçeveyle gösterilir. Bırakılınca kart yerine süzülür.
- Kart sağ alt köşesinden sürüklenerek boyutlandırılır. Sol üst köşe sabit kalır, kart canlı olarak büyür ve küçülür, komşular yer açar.
- Kartlar arasında boşluk kalmaz: her kart yukarı doğru "yer çekimiyle" oturur.
- Aynı işlemler ok tuşlarıyla ve kart menüsünden de yapılır. Esc sürüklemeyi iptal eder.
- Kaydet düzeni tarayıcıda saklar (sayfa başına ayrı). İptal taslağı atar. Varsayılana dön sayfanın kendi düzenine çevirir.
- Düzen kaydetmemiş kullanıcı sayfayı hiç değişmemiş hâliyle görür.
- Kartın boyutu içeriğini etkiler: uzayan kartta liste uzar, genişleyen kartta içerik yan yana dizilir, grafik kalan yüksekliği doldurur.
- Düzenleme yalnızca geniş ekranda (≥ 1024 px) açılır. Dar ekranda kayıtlı düzen, kartların okuma sırasına çevrilip tek sütunda gösterilir.

## 2. Ortam ve temel karar

Kaynak proje: Next.js 16 (App Router), React 19.2, TypeScript, Tailwind v4, CSS Modules. Menü için `@base-ui/react`, bildirim için `sonner`, ikon için `lucide-react` kullanılıyor.

Sürükle-bırak ya da ızgara kütüphanesi (react-grid-layout, dnd-kit, gridstack) kullanılmadı; motor yaklaşık 1.250 satır TypeScript ve 225 satır CSS'ten oluşan kendi kodumuz. Gerekçem üç şeydi:

1. Kartların düzenleme kipine girip çıkarken **yeniden yüklenmemesi** gerekiyordu (grafikte seçili dönem, açık sekme, çekilmiş veri korunmalı). Bu, sayfanın kendi JSX ağacını koruyan bir yapı istiyor.
2. Sürükleme sırasında React'in kare başına yeniden çizmemesi gerekiyordu.
3. Varsayılan düzenin elle yazılmaması, sayfanın mevcut görünümünden ölçülmesi gerekiyordu.

Hedef projede hazır bir kütüphane zaten kuruluysa bu üç gereksinimi karşılayıp karşılamadığına bakarak karar ver.

## 3. Dosyalar

Hepsi `dashboard/src/components/workspace/` altında.

| Dosya | Görev | React'e bağlı mı |
| --- | --- | --- |
| `layout-model.ts` | Izgara matematiği: taşı, boyutlandır, sıkıştır, oku/yaz. Saf fonksiyonlar. | Hayır |
| `layout-model.test.ts` | Modelin 14 testi (`node --test`). | Hayır |
| `use-layout-gesture.ts` | İşaretçi hareketi: yakalama, kare başına izleme, otomatik kaydırma, iptal. | Evet (hook) |
| `Workspace.tsx` | Sağlayıcı ve parçalar: `Workspace`, `WorkspaceControls`, `WorkspaceGrid`, `TileGroup`, `Tile`. Durum, saklama, ölçüm, animasyon. | Evet |
| `workspace.module.css` | Izgara yerleşimi, tutamaçlar, sürükleme görünümü. | — |
| `panel.ts` | Kartın yuvasını bildiren bağlam (`usePanel`) ve `useFitCount`. | Evet |

Katmanlar tek yönlü bağımlı: model hiçbir şeyi bilmez, hareket yalnızca modeli bilir, `Workspace` ikisini de kullanır, kartlar yalnızca `panel.ts`'i bilir.

## 4. Izgara geometrisi

- **6 sütun**, sütunlar arası **16 px** boşluk.
- Satır adımı **32 px**. Satırlar arası CSS boşluğu **sıfır**; dikey boşluk her kartın altına verilen 16 px kenar boşluğuyla sağlanır, ızgaranın sonundaki fazlalık `margin-block-end: -16px` ile geri alınır.

Bunun nedeni hesabın doğrusal kalması:

```
sütun adımı   = (ızgara genişliği + 16) / 6
kart genişliği = w × sütun adımı − 16
kart yüksekliği = h × 32 − 16
piksel → satır  = ceil((yükseklik + 16) / 32)
```

Satır boşluğu CSS `gap` ile verilseydi `h` satırlık kartın yüksekliği `h×32 + (h−1)×16` olurdu ve her dönüşümde bu terim taşınırdı.

Bir kart `{ id, x, y, w, h }` ile tanımlanır; `x`, `y` sıfır tabanlı sütun ve satır, `w`, `h` sütun ve satır sayısıdır. Düzen bu öğelerin dizisidir.

Her kartın sınırları vardır: `{ minW, minH, maxH, hug? }`. Varsayılan `minW: 2, minH: 5, maxH: 40`. En fazla 1.024 satır.

## 5. Yerleşim modeli (`layout-model.ts`)

Bütün fonksiyonlar saftır ve değişiklik yoksa **aynı dizi kimliğini** döndürür (`applied`). Çağıranlar `next !== layout` ile "bir şey değişti mi" sorusunu yanıtlar; hareket kodu ve klavye adımı buna dayanır.

### Yer çekimi

`settle(item, placed)` bir kartı yerleştirir: önce çakıştığı kartların altına iner, sonra aynı sütunları paylaşan en yakın üst kartın altına kadar yükselir. `stack(order, pinned)` kartları verilen sırayla tek tek oturtur; önce gelen üst satırları alır. Modelin tamamı "kartları hangi sırayla oturtacağım" sorusuna indirgenir.

### Taşıma: `moveCard(layout, id, x, y)`

1. Hedef hücre ızgara içine kırpılır.
2. Diğer kartlar okuma sırasıyla (`y`, sonra `x`) gezilir ve ikiye ayrılır: taşınan kartın **üstünde kalanlar** ve **altında kalanlar**.
3. `stack([...üsttekiler, taşınan, ...alttakiler])` çağrılır.

Ayrım komşunun dikey orta noktasına göre yapılır ve iki farklı kenar kullanılır:

- Komşu, kartın başlangıç yerinin tam altında ve aynı sütunlardaysa (kart onun üzerine itiliyor): kartın **alt kenarı** komşunun ortasını geçince yer değiştirirler.
- Diğer bütün durumlarda: kartın **üst kenarı** (tutamacın olduğu yer) komşunun ortasını geçince yer değiştirirler.

Tek kenar kullanıldığında ya yukarı ya aşağı taşımada kart komşunun neredeyse tamamını geçmeden yer değişmiyordu; iki kenarla iki yön de yarı yolda tepki veriyor.

### Boyutlandırma: `resizeCard(layout, id, w, h, limits)`

Boyut sınırlara kırpılır, kart yerinde **sabitlenir** (`pinned`), diğerleri okuma sırasıyla etrafına oturtulur, sonra bütün düzen bir kez daha sıkıştırılır (daralan kartın altındaki destek kalkmış olabilir). `hug` kartlarda yükseklik değişmez.

### Klavye adımı: `nudgeCard`

Boyutlandırmada bir sütun ya da satır değişir. Taşımada dikey adım, **düzen gerçekten değişene kadar** büyütülür; çünkü tek satırlık dikey hareketi yer çekimi hemen geri alır. Yatay adım tek sütundur.

### Diğerleri

- `packLayout`: bütün boşlukları kapatır.
- `fitHeights(layout, heights)`: içeriğine sarılan kartlara ekranda ölçülen yüksekliği verir, altlarındaki kartları iter.
- `parseLayout(raw, ids, limits)`: kayıtlı düzeni okur. Sayfada artık olmayan kartları atar, yeni kartları en alta tam genişlikte ekler, eski sınırlarla kaydedilmiş boyutları bugünkü sınırlara **kırpar** (reddetmez), boşlukları kapatır. Bozuk veri `null` döndürür ve sayfa varsayılan düzende açılır.
- `serializeLayout`: `{ version: 1, items }`.

## 6. Hareket (`use-layout-gesture.ts`)

`useLayoutGesture(grid, enabled, limits, onRelease)` şunları döndürür: `preview`, `start`, `move`, `end`, `cancelPointer`, `cancel`. Tutamaç düğmesi bunları `onPointerDown / Move / Up / Cancel / LostPointerCapture` olaylarına bağlar.

### Akış

1. **Başlangıç.** Yalnızca birincil işaretçi ve sol tuş. Tutamaç `setPointerCapture` ile işaretçiyi yakalar. İşaretçinin ızgaraya göre konumu, başlangıç düzeni (`base`) ve kartın DOM öğesi bir `ref` içinde tutulur. Henüz hiçbir şey çizilmez.
2. **Eşik.** İşaretçi 4 px oynayana kadar hareket başlamış sayılmaz; böylece tıklama sürüklemeye dönüşmez.
3. **İzleme.** Her `pointermove` yalnızca son konumu yazar ve bir `requestAnimationFrame` ister. Kare geldiğinde `follow` çalışır:
   - İşaretçinin başlangıca göre kayması hesaplanır. Izgaranın sınırları her karede yeniden okunduğu için sayfa kaydığında da doğru kalır.
   - Kayma, izin verilen aralığın dışında **lastik bant** direnciyle sönümlenir (en fazla 56 px taşar).
   - Kayma sütun ve satıra yuvarlanır, `moveCard` ya da `resizeCard` **her seferinde başlangıç düzeninden** çağrılır.
   - Kayma karta iki CSS değişkeni olarak yazılır: `--offset-x`, `--offset-y`.
4. **Önizleme.** Hesaplanan düzen öncekinden farklıysa `setPreview` çağrılır. Farklı değilse React hiç çalışmaz.
5. **Bırakma.** Son işaretçi konumuyla bir kez daha `follow` çalışır, `onRelease` çağrılır. Bırakma bilgisi kartın ekrandaki son kaymasını (`dx`, `dy`) ve boyutunu (`width`, `height`) taşır; bırakma animasyonu buradan başlar.

### Önemli ayrıntılar

- **Düzen hep başlangıçtan hesaplanır.** Artımlı güncelleme yapılmaz. İşaretçi geri getirildiğinde düzen tam olarak eski hâline döner, yol boyunca birikmiş bir durum yoktur.
- **React kare başına çizmez.** Kartın hareketi CSS değişkeniyle, DOM'a doğrudan yazılır. React yalnızca komşuların yeri değiştiğinde çalışır.
- **Sürüklenen kart başlangıç yuvasında kalır.** Önizleme düzeninde yeri değişmiş olsa bile ızgaradaki yuvası değişmez; kart oradan `transform` ile kaydırılır. Yuvası her önizlemede değişseydi kayma hesabı her seferinde sıfırlanırdı.
- **İlk karede titreme yok.** Kayma değişkenleri, React kartı "sürükleniyor" olarak işaretlemeden önce yazılır. Bırakmadan sonra da değişkenler, React işareti kaldırana kadar durur (`useLayoutEffect` içinde silinir).
- **Otomatik kaydırma.** İşaretçi pencerenin üst ya da alt 64 px'lik bandındaysa sayfa kayar (kare başına en fazla 22 px). İki koşul var: işaretçi tutulduğu yerden o kenara doğru en az 4 px gitmiş olmalı ve kartın o yönde gidecek yeri kalmış olmalı. Bu koşullar olmadan, ekranın altındaki bir köşe tutulduğu anda sayfa durmadan kayıyordu.
- **İptal.** Esc, pencere odağını yitirince, ekran kırılma noktası değişince ve işaretçi yakalaması kaybolunca hareket başlangıç düzenine döner.
- **Lastik bant formülü** (`src/lib/motion.ts`):

```ts
export function rubberBand(displacement: number, distance: number): number {
  if (distance <= 0) return 0;
  const resistance = Math.abs(displacement) * 0.55 / distance;
  return Math.sign(displacement) * (1 - 1 / (resistance + 1)) * distance || 0;
}
```

- Kodda React 19.2'nin `useEffectEvent`'i kullanılıyor. Daha eski React'te aynı işi "son fonksiyonu tutan ref" kalıbıyla yap.

## 7. Sayfaya bağlama (`Workspace.tsx`)

### 7.1 Sayfa tarafı

Sayfa kendi JSX'ini korur. Yapılan şey sarmalamaktır:

```tsx
<Workspace
  page="home"
  cards={{
    index: { label: "BIST 100", minW: 3, minH: 15 },
    watchlist: { label: t("dashboard.watchlist"), minH: 8 },
    breadth: { label: t("dashboard.breadth"), minH: 8 },
    events: { label: t("dashboard.latestDevelopments"), minH: 6 },
  }}
>
  <MarketHeader actions={<WorkspaceControls />} />
  <WorkspaceGrid className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
    <Tile id="index" className="lg:col-span-2"><IndexChartCard /></Tile>
    <TileGroup className="flex min-w-0 flex-col gap-4 lg:row-span-2">
      <Tile id="watchlist"><WatchlistCard /></Tile>
      <Tile id="breadth" className="grow"><MarketBreadthCard /></Tile>
    </TileGroup>
    <Tile id="events" className="lg:col-span-2 lg:self-start"><LatestEventsCard /></Tile>
  </WorkspaceGrid>
</Workspace>
```

- `Workspace`: durumu tutan sağlayıcı. `page` kayıt anahtarını belirler; aynı adı kullanan görünümler aynı düzeni paylaşır (hisse sayfalarında düzen hisseden bağımsızdır). `cards` kayıt defteridir: kart kimliği → ad ve sınırlar.
- `WorkspaceControls`: Özelleştir ve düzenleme düğmeleri. Sayfanın başlığına konur. `compact` yazılı ipucunu gizler (dar satırlar için).
- `WorkspaceGrid`: kartların kabı. `className` sayfanın **varsayılan** yerleşimidir; bir düzen yürürlüğe girince bu sınıf bırakılır ve ızgara devralır.
- `Tile`: tek bir kart. `className` kartın varsayılan yerleşimdeki yeridir ve o da düzen yürürlükteyken bırakılır.
- `TileGroup`: yalnızca kartları dizen sarmalayıcı (satır, sütun, başlıklı bölüm). Düzen yürürlükteyken `display: contents` olur, yani kutusu kaybolur ve içindeki kartlar doğrudan ızgaraya yerleşir.
- `DEFAULT_LAYOUT_ONLY`: yalnızca varsayılan yerleşime ait başlıklara yayılır (`<h2 {...DEFAULT_LAYOUT_ONLY}>`); düzen yürürlükteyken gizlenir.

### 7.2 Aynı ağaç ilkesi

Varsayılan görünüm ile özelleştirilmiş görünüm **aynı React ağacıdır**; değişen yalnızca CSS sınıfları ve `style` değerleridir. Bu yüzden kipler arasında hiçbir kart yeniden yüklenmez. İlk sürümde iki ayrı ağaç vardı (varsayılan yerleşim ve ızgara) ve kip değişince kartlar baştan kuruluyordu; bunu bilerek kaldırdık.

Bunun bedeli: DOM sırası (dolayısıyla Tab sırası ve ekran okuyucu sırası) sayfanın varsayılan sırasında kalır, ekrandaki yeni sırayı izlemez.

### 7.3 Durum türetme zinciri

`Workspace` içinde her çizimde şu zincir hesaplanır:

```
stored   = localStorage'daki ham metin (useSyncExternalStore)
saved    = parseLayout(stored)                      → kayıtlı düzen ya da null
draft    = düzenleme açıksa edit.layout, değilse saved
present  = draft − (hiçbir şey çizmemiş kartlar), sıkıştırılmış
base     = fitHeights(present, ölçülen yükseklikler) → ekranda geçerli düzen
preview  = hareket sürüyorsa gesture.preview
layout   = preview?.layout ?? base
slots    = her kartın çizileceği yuva; sürüklenen kart base'deki yuvasında kalır
landing  = sürüklenen kartın oturacağı yer (kesik çerçeve)
```

Üç bayrak bunlardan çıkar:

- `customized = layout !== null`: bir düzen yürürlükte (her ekranda).
- `positioned = desktop && customized`: düzen ızgarada gösteriliyor.
- `editing = desktop && edit !== null`: tutamaçlar görünür.

`edit` durumu `{ layout, status }` biçimindedir; `status` `"unchanged" | "changed" | "reset"` olur. Kaydet: `unchanged` ise yalnızca kapatır, `reset` ise kaydı siler, `changed` ise `base`'i yazar.

### 7.4 Varsayılan düzen ekrandan ölçülür

Hiçbir sayfa için elle varsayılan düzen yazılmadı. Özelleştir'e basıldığında kayıt yoksa `measureDefault` çalışır: her `[data-tile]` öğesinin `getBoundingClientRect` değeri ızgaranın sol üst köşesine göre sütun ve satıra çevrilir, sınırlara kırpılır, sıkıştırılır. Sonuç, sayfanın o anki görünümünün ızgaradaki karşılığıdır; kullanıcı kipe girdiğinde kartlar yerinden oynamaz.

**Varsayılana dön** aynı ölçümü kullanır ama önce sayfayı bir an için varsayılan yerleşime çevirmesi gerekir: `flushSync` ile `edit.layout = null` yapılır, DOM ölçülür, ölçülen düzen yazılır. Bu ara çizimde animasyon etkisi çalışmasın diye bir `measuring` bayrağı tutulur.

Bilinen yan etki: kartlar hâlâ yükleniyorken Özelleştir'e basılırsa iskelet yükseklikleri ölçülür.

### 7.5 Üç özel kart türü

- **`hug` (içeriğine sarılan).** Yüksekliği içeriğinden gelen bloklar (rakam şeritleri, tablolar). Kart yuvayı doldurmaz; yuva kartın yüksekliğini alır. `Tile` bir `ResizeObserver` ile yüksekliğini satıra çevirip bildirir, `fitHeights` altındaki kartları iter. Taşınabilir; genişliği yalnızca `minW < 6` ise değişir (tam genişlik isteyen blokta boyutlandırma tutamacı hiç çizilmez).
- **`lazy`.** Kart, görünür alana 600 px yaklaşınca (`IntersectionObserver`) kurulur; o zamana kadar `placeholderHeight` yüksekliğinde bir iskelet durur. Uzun sayfalarda ağ isteklerini erteler.
- **Yok (absent).** Bazı kartlar hiçbir şey çizmez (örneğin sektörü olmayan hissede sektör karşılaştırması). `Tile`, bir `MutationObserver` ile kendi denetimleri dışında çocuğu olup olmadığına bakar. Yoksa gizlenir ve düzenden çıkarılır; kayıtlı düzendeki yeri korunur, içerik gelince geri döner. Bunun için tutamaçlar `data-tile-chrome` ile işaretlidir.

### 7.6 Saklama

- Anahtar: `hisse.layout.<page>`. Değer: `{ "version": 1, "items": [{ id, x, y, w, h }, …] }`.
- Okuma `useSyncExternalStore` ile yapılır; `storage` olayı ve kendi `workspace-layout-saved` olayımız dinlenir, yani başka sekmedeki kayıt da yansır.
- Sunucu tarafı anlık görüntüsü `null`'dır: sunucudan gelen HTML her zaman varsayılan yerleşimdir, kayıtlı düzen tarayıcıda uygulanır.
- `localStorage` yazmayı reddederse (gizli pencere, dolu kota) düzen bir `Map` içinde oturum boyunca tutulur ve kullanıcıya uyarı gösterilir.
- Sunucuda saklama yok. Hedef projede hesap bazlı saklama istenirse değiştirilecek yer yalnızca `readStorage`, `subscribe` ve `saveLayout`'tur.

## 8. Çizim ve animasyon

### CSS

- Her kart yuvasını dört CSS değişkeninden alır: `--column`, `--row`, `--columns`, `--rows` → `grid-column: var(--column) / span var(--columns)`.
- Varsayılan kipte `.tile` görünmez bir kutudur, içindeki kart onu doldurur (`flex: 1 0 auto`).
- Izgarada kart yuvayı doldurur ve taşan içerik **kartın içinde** kayar: `.positioned .tile > * { flex: 1 1 0; min-height: 0 }`.
- Taşıma: `transform: translate3d(var(--offset-x), var(--offset-y), 0)`.
- Boyutlandırma: `width: calc(100% + var(--offset-x)); height: calc(100% - 16px + var(--offset-y))`, `align-self: start`.
- Tutamaçlar `position: absolute` ile kartın **dışına** taşar (üst hap −13 px, köşe −5 px). Akışta yer kaplamazlar; düzenleme kipine girince hiçbir kart kaymaz.
- Dokunmatik işaretçide (`pointer: coarse`) tutamaçlar büyür. Tutamaçlarda `touch-action: none` vardır.

### Kayma animasyonu (FLIP)

Komşu kartlar yeni yerlerine atlamaz, süzülür. `Workspace` içindeki bağımlılıksız `useLayoutEffect` her çizimden sonra çalışır:

1. Bir önceki çizimde her kartın yuvası ve ızgara genişliği bir `ref`'te tutulur.
2. Yuvası değişen her kart için kayma **aritmetikle** bulunur: `(eski.x − yeni.x) × sütun adımı`, `(eski.y − yeni.y) × 32`. DOM ölçülmez.
3. Kart, Web Animations API ile o kaymadan sıfıra oynatılır.

Ayrıntılar:

- Animasyon `transform` yerine tekil **`translate`** özelliğiyle yapılır. `transform` sürükleme kaymasına ayrılmıştır; ikisi birbirini ezmeden birleşir.
- Uçuştaki bir animasyon kesilirse kartın o anki `translate` değeri okunup yeni kaymaya eklenir; kart sıçramaz.
- Bırakılan kart, bırakıldığı andaki kaymasından yuvasına süzülür. Boyutlandırılan kart, bırakıldığı andaki piksel boyutundan yuvanın boyutuna `width`/`height` kareleriyle geçer.
- Süreler: kesik çerçeve 150 ms, bırakılan kart 200 ms, komşular 250 ms. Eğri: `cubic-bezier(0.23, 1, 0.32, 1)`.
- Izgara genişliği değiştiyse (pencere boyutu) animasyon yapılmaz, sürenler iptal edilir.
- "Hareketi azalt" ayarında ve sekme gizliyken animasyon hiç başlatılmaz. Hareketi azalt ayarında sürüklenen kart da imleci izlemez; yalnızca kesik çerçeve hedefi gösterir.
- Düzenleme kipine giriş animasyonsuzdur; kartlar zaten ölçüldükleri yerdedir.

## 9. Kartın boyuta uyması (`panel.ts`)

`Tile`, içindeki karta bir bağlam verir:

```ts
type PanelState = { fill: boolean; columns: number; rows: number };
```

- `fill`: kart sabit boyutlu bir yuvayı dolduruyor. Varsayılan yerleşimde ve `hug` kartlarda `false`.
- `columns`, `rows`: yuvanın sütun ve satır sayısı.

Kartlar bunu üç biçimde kullanıyor.

**1. Kart iskeleti yuvayı doldurur.** Ortak kart bileşeni `fill` iken dikey esnek kutu olur, başlığı sabit kalır, gövdesi kalan yüksekliği alır ve kayar:

```tsx
const { fill } = usePanel();
<section className={cn("card-surface", fill && "flex min-h-0 flex-col")}>
  <header className="shrink-0">…</header>
  <div className={cn(fill && "min-h-0 flex-1 overflow-y-auto")}>…</div>
</section>
```

Bu tek değişiklik projedeki kartların çoğunu ızgaraya uygun hâle getirdi; her kartı ayrı ayrı ele almak gerekmedi.

**2. Liste, sığdığı kadar satır gösterir.** `useFitCount(rowHeight, natural, reserve)` gövdenin yüksekliğini `ResizeObserver` ile izler ve `floor((yükseklik − reserve) / rowHeight)` döndürür. Varsayılan yerleşimde `natural` döner.

```tsx
const [bodyRef, visibleCount] = useFitCount(58, 6);   // satır 58 px, varsayılan 6 satır
<CardBody ref={bodyRef}>{items.slice(0, visibleCount).map(…)}</CardBody>
```

Satır yüksekliği sabit olmalıdır. `reserve`, gövdede listeden başka yer kaplayan şeylerin toplam yüksekliğidir.

**3. Genişliğe göre yerleşim değişir.** Örnek: "yükselenler / düşenler" kartı 4 sütun ve üzerinde iki listeyi yan yana dizer, dar kartta alt alta.

```tsx
const wide = usePanel().columns >= 4;
<div className={cn(wide && "grid grid-cols-2 divide-x")}>…</div>
```

Diğer uyarlamalar: "tümünü göster" düğmesi olan listeler `fill` iken hepsini gösterir ve düğmeyi gizler; grafikler sabit yükseklik yerine kalan alanı doldurur.

Dikkat: veriyi sunucudan sınırla çeken bir liste (`limit=10`) uzayınca daha çok kayıt gösteremez. Sınırı kart boyutuna bağlamak istersen sınır sorgu anahtarının parçası olmalı; bizde değildi, o kartı 10 kayıtta bıraktık.

## 10. Klavye ve erişilebilirlik

- Tutamaçlar gerçek `<button>` öğeleridir; `aria-label` kart adını içerir ("BIST 100 kartını taşı").
- Taşıma tutamacında ok tuşları kartı taşır, boyutlandırma tutamacında boyutlandırır.
- Kart menüsü aynı sekiz adımı sunar; yapılamayan adım devre dışıdır (`canNudge`). `hug` kartta yalnızca genişlik adımları görünür.
- Her adımdan sonra odak aynı denetime geri konur (kart yer değiştirse bile) ve kart görünür alana kaydırılır.
- Her değişiklik bir canlı bölgede (`role="status"`) duyurulur: "BIST 100: sütun 1, satır 1, genişlik 4, yükseklik 15."
- Kipe girince odak Kaydet'e, çıkınca Özelleştir'e geçer.
- Esc süren sürüklemeyi iptal eder.

## 11. Dar ekran

1024 px'in altında düzenleme düğmeleri gizlidir. Kayıtlı düzen varsa kap `display: flex; flex-direction: column` olur ve kartlar `order: var(--order)` ile okuma sırasına dizilir; boyutlar yok sayılır. Kayıt yoksa sayfa kendi duyarlı yerleşimini kullanır.

## 12. Düştüğümüz hatalar

Bunları yeniden yaşamaman için:

1. **Kenarda tutulan tutamaç sayfayı kaydırıyordu.** Çözüm: kaydırma için işaretçinin kenara doğru gitmiş olması ve kartın o yönde yeri olması şartı (bölüm 6).
2. **Grafik kartı 48 px'e kadar ezilebiliyordu.** Her kartın kendi `minH` değeri olmalı; grafikler için yüksek tut (bizde 14–15 satır).
3. **Sınır değişince eski kayıt reddediliyordu.** `parseLayout` artık boyutu kırpıyor; kullanıcı düzenini kaybetmiyor.
4. **`data-slot` adı çakıştı.** shadcn bileşenleri de `data-slot` kullanıyor; kart işareti `data-tile` oldu. Hedef projede seçici adlarını kontrol et.
5. **Tam genişlik isteyen `hug` kartta boyutlandırma köşesi görünüyordu.** `resizable` bayrağı eklendi.
6. **Dağılan grubun boşluğu kartlara kalıyordu.** `TileGroup` `display: contents` olsa da Tailwind'in `space-y-*` sınıfı çocuklara kenar boşluğu vermeye devam eder. `.custom .tile { margin-block: 0 }` ile sıfırlandı; ızgarada alt boşluk sonradan yeniden verilir.
7. **Başlık satırındaki ipucu metni taşıyordu.** Dar başlıklar için `compact` eklendi.
8. **Gizli sekmede animasyon ilerlemez.** `requestAnimationFrame` ve Web Animations gizli sekmede durur; animasyonu sekme görünürken başlat (`useMotionAllowed`). Otomatik testlerde de bu yüzden animasyon yarıda kalmış görünebilir.
9. **Genişlik değişirken FLIP yanlış kayma üretir.** Önceki yuvalar eski sütun adımına göredir; genişlik değiştiyse animasyonu atla.
10. **Tek kenarlı yer değiştirme eşiği** bir yönde ağır hissettiriyordu (bölüm 5).

## 13. Taşırken değiştireceklerin

Motor şu proje içi parçalara dayanıyor; hedef projede karşılıklarını bağla:

| Kullanılan | Ne işe yarıyor | Hedefte |
| --- | --- | --- |
| `useLocale().t`, `dashboard.*` anahtarları | Düğme, etiket ve duyuru metinleri (12 anahtar) | Kendi çeviri sistemin ya da sabit metin |
| `@/lib/motion` (`motionDuration`, `motionCurve`, `cubicBezier`, `rubberBand`) | Süre, eğri, lastik bant | Değerler bölüm 6 ve 8'de; kopyala |
| `useMotionAllowed`, `motionScrollBehavior` | Hareketi azalt ve sekme görünürlüğü | `matchMedia("(prefers-reduced-motion: reduce)")` + `document.visibilityState` |
| `useMediaQuery` | Geniş ekran sorgusu | Herhangi bir `matchMedia` hook'u |
| `Button`, `Skeleton`, `cn` | Arayüz parçaları | Kendi bileşenlerin |
| `ReleaseMenu`, `MotionMenuPopup` (`@base-ui/react/menu`) | Kart seçenek menüsü | Herhangi bir erişilebilir menü |
| `toast` (`sonner`) | Kaydedildi / kaydedilemedi bildirimi | Kendi bildirimin |
| `card-surface` sınıfı, `--radius`, `--border`, `--card`, `--primary`, `--muted`, `--ring`, `--motion-*` CSS değişkenleri | Görünüm | Kendi tasarım değişkenlerin |
| `STORAGE_PREFIX = "hisse.layout."` | Kayıt anahtarı | Projene göre değiştir |

Ayarlanabilir sabitler `layout-model.ts`'in başındadır: sütun sayısı, satır adımı, boşluk, geniş ekran sorgusu. CSS'teki `@media (min-width: 64rem)` ile `WORKSPACE_DESKTOP_QUERY` aynı değeri taşımalıdır.

Önerdiğim sıra:

1. `layout-model.ts` ve testlerini al, testleri çalıştır.
2. `use-layout-gesture.ts`, `Workspace.tsx`, CSS ve `panel.ts`'i al, yukarıdaki bağımlılıkları bağla.
3. Tek bir sayfayı sar; düzenleme kipine girildiğinde kartların yerinden oynamadığını doğrula.
4. Ortak kart bileşenini `fill`'e duyarlı yap.
5. Listeleri ve grafikleri boyuta uydur.
6. Diğer sayfaları sar; `hug`, `lazy` ve boş kart durumlarını ele al.

## 14. Kaynak projede bağlanan sayfalar

| Sayfa | Kayıt adı | Notlar |
| --- | --- | --- |
| Piyasa Özeti | `home` | 4 kart, hepsi boyutlandırılabilir |
| Hisse: Genel Bakış, Temel, Teknik, Kombine | `stock-overview`, `stock-fundamental`, `stock-technical`, `stock-combined` | Fiyat özeti şeridi `hug`; alt kartlar `lazy`; düğmeler sekme satırında `compact` |
| Makro | `macro` | Dört panel boyutlandırılabilir; gösterge şeritleri, piyasalar ve takvim `hug` ve tam genişlik (yalnızca taşınır); bölüm başlıkları düzen yürürlükteyken gizlenir |

Filtre ve sonuç listesinden oluşan tek yüzeyli sayfalar (haber akışı, tarama) kapsam dışında bırakıldı; taşınacak ayrı kartları yok.

## 15. Doğrulama durumu ve bilinen sınırlar

Doğrulananlar: model testleri (14), lint, tip denetimi, üretim derlemesi; tarayıcıda gerçek fareyle taşıma ve köşeden boyutlandırma; klavye ve menü adımları; kaydet → yenile; dar ekran sırası; listenin kart uzayınca uzaması (örnek veriyle 6 → 9 satır); kip değişiminde kartların yeniden yüklenmemesi.

Doğrulanmayanlar: animasyonun akıcılığı (önizleme penceresi gizliydi, kareler yalnızca ekran görüntüsü alınırken çizildi); dokunmatik ekran; "hareketi azalt" ayarı; hiçbir şey çizmeyen kart yolu canlı veriyle.

Bilinen sınırlar:

- Tab ve ekran okuyucu sırası varsayılan sırada kalır.
- Düzen cihaza bağlıdır (yalnızca `localStorage`).
- Sunucudan gelen ilk HTML varsayılan yerleşimdedir; kayıtlı düzen tarayıcıda uygulanır.
- Yüklenirken ölçülen kartlar iskelet yüksekliğini alır.
- Kart yüksekliği satıra yukarı yuvarlandığı için düzenleme kipine girildiğinde bir kart en fazla 31 px uzayabilir.
- `useFitCount` sabit satır yüksekliği varsayar.

## 16. Kabul ölçütleri

Hedef projede iş şu durumda bitmiş sayılır:

- Düzen kaydetmemiş kullanıcı için sayfa piksel düzeyinde değişmemiş.
- Özelleştir'e basınca hiçbir kart yerinden oynamıyor ve hiçbir kart yeniden yüklenmiyor.
- Sürükleme sırasında React kare başına çizmiyor; kart imleci gecikmesiz izliyor.
- Kartlar arasında hiçbir durumda boşluk ya da çakışma kalmıyor.
- Bırakılan kart ve yer değiştiren komşular süzülerek oturuyor; "hareketi azalt" ayarında anında oturuyor.
- Her işlem klavyeyle yapılabiliyor ve duyuruluyor.
- Bozuk ya da eski kayıt sayfayı kırmıyor.
- Kart büyüdüğünde boş alan değil, daha fazla içerik görünüyor.

---

# Ek: kaynak dosyalar

## Ek A. `layout-model.ts`

```ts
export const WORKSPACE_COLUMNS = 6;
export const WORKSPACE_ROW_STEP = 32;
export const WORKSPACE_GAP = 16;
export const WORKSPACE_DESKTOP_QUERY = "(min-width: 64rem)";
export const MAX_GRID_ROWS = 1024;

export type LayoutItem = Readonly<{ id: string; x: number; y: number; w: number; h: number }>;
export type WorkspaceLayout = readonly LayoutItem[];
export type LayoutChange = "move" | "resize";
/**
 * Sizes a card may be resized to, in columns and rows. A card that hugs its
 * content takes its height from that content, so only its width can be changed.
 */
export type CardLimits = Readonly<{ minW: number; minH: number; maxH: number; hug?: boolean }>;
export type Limits = (id: string) => CardLimits;

const LAYOUT_VERSION = 1;

export const DEFAULT_LIMITS: CardLimits = { minW: 2, minH: 5, maxH: 40 };

/** Visual top-to-bottom order doubles as the reading order when cards stack. */
export function readingOrder(layout: WorkspaceLayout): LayoutItem[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Rows the layout occupies, from the top of the grid to the bottom of its lowest card. */
export function layoutRows(layout: WorkspaceLayout): number {
  return Math.max(0, ...layout.map(({ y, h }) => y + h));
}

function sharesColumns(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/**
 * Cards have gravity toward the top of the grid: a card first drops below
 * whatever occupies its rows, then rises until the nearest card above stops it.
 */
function settle(item: LayoutItem, placed: readonly LayoutItem[]): LayoutItem {
  const column = placed.filter((other) => sharesColumns(item, other));
  let y = item.y;
  for (let blocked = true; blocked; ) {
    blocked = false;
    for (const other of column) {
      if (y < other.y + other.h && other.y < y + item.h) {
        y = other.y + other.h;
        blocked = true;
      }
    }
  }
  y = Math.max(0, ...column.filter((other) => other.y + other.h <= y).map((other) => other.y + other.h));
  return y === item.y ? item : { ...item, y };
}

/** Settle the cards one after another; earlier cards claim the higher rows. */
function stack(order: readonly LayoutItem[], pinned: readonly LayoutItem[] = []): LayoutItem[] | null {
  const placed = [...pinned];
  for (const item of order) placed.push(settle(item, placed));
  return layoutRows(placed) > MAX_GRID_ROWS ? null : placed;
}

function bounded(value: number, previous: number, min: number, max: number): number {
  const next = Number.isFinite(value) ? Math.round(value) : previous;
  return Math.max(min, Math.min(next, max));
}

export function sameLayout(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  return a === b || (a.length === b.length && a.every((item) => {
    const other = b.find(({ id }) => id === item.id);
    return other !== undefined && other.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h;
  }));
}

/** The same array is returned when nothing moved, so callers can compare by identity. */
function applied(layout: WorkspaceLayout, placed: readonly LayoutItem[] | null): WorkspaceLayout {
  if (placed === null) return layout;
  const next = layout.map((item) => placed.find(({ id }) => id === item.id) ?? item);
  return sameLayout(next, layout) ? layout : next;
}

/**
 * Move a card to a grid cell. The card takes the first free rows at or below
 * that cell and every other card closes the gap it left.
 *
 * A neighbour swaps sides once the dragged card crosses its vertical midpoint:
 * the bottom edge leads when the card is pushed down onto the cards stacked
 * beneath it, the top edge (where the handle is) leads everywhere else.
 */
export function moveCard(layout: WorkspaceLayout, id: string, x: number, y: number): WorkspaceLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;

  const target = {
    ...current,
    x: bounded(x, current.x, 0, WORKSPACE_COLUMNS - current.w),
    y: bounded(y, current.y, 0, MAX_GRID_ROWS - current.h),
  };
  if (target.x === current.x && target.y === current.y) return layout;

  const above: LayoutItem[] = [];
  const below: LayoutItem[] = [];
  for (const other of readingOrder(layout)) {
    if (other.id === id) continue;
    const middle = other.y + other.h / 2;
    const stackedBeneath = other.y >= current.y + current.h && sharesColumns(other, current);
    const staysAbove = stackedBeneath ? middle < target.y + target.h : middle <= target.y;
    (staysAbove ? above : below).push(other);
  }
  return applied(layout, stack([...above, target, ...below]));
}

/** Resize a card from its bottom-right corner, then close any gaps it leaves. */
export function resizeCard(layout: WorkspaceLayout, id: string, w: number, h: number, limits: Limits): WorkspaceLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;

  const { minW, minH, maxH, hug } = limits(id);
  const target = {
    ...current,
    w: bounded(w, current.w, Math.min(minW, WORKSPACE_COLUMNS - current.x), WORKSPACE_COLUMNS - current.x),
    h: hug ? current.h : bounded(h, current.h, minH, maxH),
  };
  if (target.w === current.w && target.h === current.h) return layout;
  const placed = stack(readingOrder(layout).filter((item) => item.id !== id), [target]);
  // Pack again if the new width removed support under the resized card or a neighbour.
  return applied(layout, placed && stack(readingOrder(placed)));
}

/**
 * One keyboard or menu step. A resize changes one column or row. A move goes
 * on until the layout actually changes, because gravity undoes a single row.
 */
export function nudgeCard(
  layout: WorkspaceLayout,
  id: string,
  change: LayoutChange,
  dx: number,
  dy: number,
  limits: Limits,
): WorkspaceLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;
  if (change === "resize") return resizeCard(layout, id, current.w + dx, current.h + dy, limits);

  const reach = dy === 0 ? 1 : layoutRows(layout);
  for (let step = 1; step <= reach; step++) {
    const next = moveCard(layout, id, current.x + dx * step, current.y + dy * step);
    if (next !== layout) return next;
  }
  return layout;
}

/** Close every gap, keeping the cards in their reading order. */
export function packLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return applied(layout, stack(readingOrder(layout)));
}

/**
 * Give cards that hug their content the heights measured on screen. The cards
 * beneath them follow, so a strip that grows a line never covers its neighbour.
 */
export function fitHeights(layout: WorkspaceLayout, heights: ReadonlyMap<string, number>): WorkspaceLayout {
  if (heights.size === 0) return layout;
  const sized = layout.map((item) => {
    const h = heights.get(item.id);
    return h === undefined || h === item.h || h < 1 ? item : { ...item, h };
  });
  return applied(layout, stack(readingOrder(sized)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gridInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function parseItem(value: unknown, ids: readonly string[], limits: Limits): LayoutItem | null {
  if (!isRecord(value)) return null;
  const id = ids.find((candidate) => candidate === value.id);
  if (id === undefined) return null;

  const { x, y } = value;
  if (!gridInteger(value.w, 1, WORKSPACE_COLUMNS) || !gridInteger(value.h, 1, MAX_GRID_ROWS)) return null;
  if (!gridInteger(x, 0, WORKSPACE_COLUMNS - 1) || !gridInteger(y, 0, MAX_GRID_ROWS - 1)) return null;
  // Sizes saved under earlier limits are brought inside the current ones.
  const { minW, minH, maxH, hug } = limits(id);
  const w = Math.max(minW, value.w);
  const h = hug ? value.h : Math.max(minH, Math.min(value.h, maxH));
  return { id, x: Math.min(x, WORKSPACE_COLUMNS - w), y, w, h };
}

/**
 * Read a saved layout for the cards a page has today. Cards the page no longer
 * has are dropped, new ones are appended full width and gaps are closed.
 */
export function parseLayout(raw: string | null, ids: readonly string[], limits: Limits): WorkspaceLayout | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(stored) || stored.version !== LAYOUT_VERSION || !Array.isArray(stored.items)) return null;

  const saved = new Map<string, LayoutItem>();
  for (const value of stored.items) {
    const item = parseItem(value, ids, limits);
    if (item && !saved.has(item.id)) saved.set(item.id, item);
  }
  if (saved.size === 0) return null;

  const bottom = layoutRows([...saved.values()]);
  const added = ids
    .filter((id) => !saved.has(id))
    .map((id) => ({ id, x: 0, y: bottom, w: WORKSPACE_COLUMNS, h: Math.max(limits(id).minH, 10) }));
  const placed = stack([...readingOrder([...saved.values()]), ...added]);
  if (placed === null) return null;
  return ids.flatMap((id) => placed.find((position) => position.id === id) ?? []);
}

export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify({ version: LAYOUT_VERSION, items: layout });
}
```

## Ek B. `use-layout-gesture.ts`

```ts
"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { rubberBand } from "@/lib/motion";
import {
  WORKSPACE_COLUMNS,
  WORKSPACE_DESKTOP_QUERY,
  WORKSPACE_GAP,
  WORKSPACE_ROW_STEP,
  layoutRows,
  moveCard,
  resizeCard,
  sameLayout,
  type LayoutChange,
  type LayoutItem,
  type Limits,
  type WorkspaceLayout,
} from "./layout-model";

/** The layout the cards would take if the pointer let go now. */
export type GesturePreview = { kind: LayoutChange; id: string; layout: WorkspaceLayout };

/** Where the card floated when the gesture ended, so it can glide into its slot. */
export type GestureRelease = {
  kind: LayoutChange;
  id: string;
  /** Unchanged from the starting layout when the gesture was cancelled or did not cross a cell. */
  layout: WorkspaceLayout;
  changed: boolean;
  dx: number;
  dy: number;
  width: number;
  height: number;
};

type Gesture = {
  kind: LayoutChange;
  item: LayoutItem;
  base: WorkspaceLayout;
  handle: HTMLButtonElement;
  tile: HTMLElement;
  pointer: number;
  startX: number;
  startY: number;
  originY: number;
  clientX: number;
  clientY: number;
  started: boolean;
  dx: number;
  dy: number;
  /** Whether the card can still travel up or down; the page stops scrolling once it cannot. */
  room: { up: boolean; down: boolean };
  layout: WorkspaceLayout;
};

const EDGE = 64;
const ACTIVATION_DISTANCE = 4;
/** How far a card can be pulled past the grid or its size limits before it stops. */
const OVERSHOOT = 56;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Follow the pointer inside the range and resist it outside. */
function resist(value: number, min: number, max: number) {
  if (value < min) return min + rubberBand(value - min, OVERSHOOT);
  if (value > max) return max + rubberBand(value - max, OVERSHOOT);
  return value;
}

/**
 * Scroll while the pointer is held near the top or bottom of the window.
 * A handle that was picked up inside that band scrolls only once the pointer
 * has travelled toward the edge, so grabbing a low corner does not move the page.
 */
function scrollSpeed(y: number, originY: number) {
  const height = window.innerHeight;
  if (y < EDGE && y < originY - ACTIVATION_DISTANCE) return -clamp((EDGE - y) / 4, 0, 22);
  if (y > height - EDGE && y > originY + ACTIVATION_DISTANCE) return clamp((y - height + EDGE) / 4, 0, 22);
  return 0;
}

/**
 * A single pointer owns the gesture. The card stays in its starting slot and
 * follows the pointer through CSS variables written once per frame, so React
 * renders only when the previewed layout changes. That layout is always
 * recalculated from the starting positions.
 */
export function useLayoutGesture(
  grid: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  limits: Limits,
  onRelease: (release: GestureRelease) => void,
) {
  const [preview, setPreview] = useState<GesturePreview | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const floated = useRef<HTMLElement | null>(null);
  const frame = useRef(0);

  function follow(current: Gesture) {
    const bounds = grid.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;

    const { item, kind, base, tile } = current;
    const columnStep = (bounds.width + WORKSPACE_GAP) / WORKSPACE_COLUMNS;
    const rawX = current.clientX - bounds.left - current.startX;
    const rawY = current.clientY - bounds.top - current.startY;
    let minX: number, maxX: number, minY: number, maxY: number;
    if (kind === "move") {
      minX = -item.x * columnStep;
      maxX = (WORKSPACE_COLUMNS - item.x - item.w) * columnStep;
      minY = -item.y * WORKSPACE_ROW_STEP;
      maxY = Math.max(0, layoutRows(base) - item.y - item.h) * WORKSPACE_ROW_STEP;
    } else {
      const { minW, minH, maxH, hug } = limits(item.id);
      minX = (Math.min(minW, item.w) - item.w) * columnStep;
      maxX = (WORKSPACE_COLUMNS - item.x - item.w) * columnStep;
      // A card that hugs its content has no height of its own to drag.
      minY = hug ? 0 : (Math.min(minH, item.h) - item.h) * WORKSPACE_ROW_STEP;
      maxY = hug ? 0 : (Math.max(maxH, item.h) - item.h) * WORKSPACE_ROW_STEP;
    }

    const columns = Math.round(clamp(rawX, minX, maxX) / columnStep);
    const rows = Math.round(clamp(rawY, minY, maxY) / WORKSPACE_ROW_STEP);
    current.dx = resist(rawX, minX, maxX);
    current.dy = resist(rawY, minY, maxY);
    current.room = { up: rawY > minY, down: rawY < maxY };
    const layout = kind === "move"
      ? moveCard(base, item.id, item.x + columns, item.y + rows)
      : resizeCard(base, item.id, item.w + columns, item.h + rows, limits);
    // Keep the previous array while the cards stay put, so an unchanged preview is not rendered again.
    if (!sameLayout(layout, current.layout)) current.layout = layout;
    tile.style.setProperty("--offset-x", `${current.dx}px`);
    tile.style.setProperty("--offset-y", `${current.dy}px`);
  }

  function show(current: Gesture) {
    follow(current);
    setPreview((shown) =>
      shown?.id === current.item.id && shown.kind === current.kind && shown.layout === current.layout
        ? shown
        : { kind: current.kind, id: current.item.id, layout: current.layout });
  }

  function schedule() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const current = gesture.current;
      if (!current?.started) return;
      const speed = scrollSpeed(current.clientY, current.originY);
      const before = window.scrollY;
      if (speed < 0 ? current.room.up : speed > 0 && current.room.down) window.scrollBy({ top: speed, behavior: "instant" });
      show(current);
      if (window.scrollY !== before) schedule();
    });
  }

  function start(event: PointerEvent<HTMLButtonElement>, item: LayoutItem, kind: LayoutChange, base: WorkspaceLayout) {
    if (!enabled || gesture.current || !event.isPrimary || event.button !== 0) return;
    const bounds = grid.current?.getBoundingClientRect();
    const tile = event.currentTarget.closest<HTMLElement>("[data-tile]");
    if (!bounds || !tile) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      kind, item, base, tile, handle: event.currentTarget, pointer: event.pointerId,
      startX: event.clientX - bounds.left, startY: event.clientY - bounds.top,
      originY: event.clientY, clientX: event.clientX, clientY: event.clientY, started: false,
      dx: 0, dy: 0, room: { up: true, down: true }, layout: base,
    };
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const starting = !current.started;
    if (starting && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < ACTIVATION_DISTANCE) return;
    current.started = true;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    if (!starting) {
      schedule();
      return;
    }
    // Position the card before React marks it as floating, so it never flashes at a stale offset.
    floated.current = current.tile;
    show(current);
  }

  function stop(commit: boolean) {
    const current = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (!current) return;
    if (current.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
    if (!current.started) return;
    // The final pointer position decides the destination, while the glide
    // starts at the last geometry shown on screen.
    const { dx, dy, tile } = current;
    const { offsetWidth: width, offsetHeight: height } = tile;
    if (commit) follow(current);
    const layout = commit ? current.layout : current.base;
    onRelease({
      kind: current.kind,
      id: current.item.id,
      layout,
      changed: layout !== current.base,
      dx,
      dy,
      width,
      height,
    });
    setPreview(null);
  }

  function end(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    stop(true);
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointer === event.pointerId) stop(false);
  }

  const cancel = useEffectEvent(() => stop(false));
  const onScroll = useEffectEvent(schedule);

  // The offsets outlive the gesture until React has stopped floating the card.
  useLayoutEffect(() => {
    if (preview || !floated.current) return;
    floated.current.style.removeProperty("--offset-x");
    floated.current.style.removeProperty("--offset-y");
    floated.current = null;
  }, [preview]);

  useEffect(() => {
    const breakpoint = window.matchMedia(WORKSPACE_DESKTOP_QUERY);
    function onCancel() {
      if (gesture.current) cancel();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || !gesture.current) return;
      event.preventDefault();
      onCancel();
    }
    function handleScroll() {
      if (gesture.current?.started) onScroll();
    }
    breakpoint.addEventListener("change", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      const current = gesture.current;
      gesture.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (current?.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
      breakpoint.removeEventListener("change", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return { preview: enabled ? preview : null, start, move, end, cancelPointer, cancel: () => stop(false) };
}
```

## Ek C. `panel.ts`

```ts
"use client";

import { createContext, useCallback, useContext, useState } from "react";

/** The slot a card occupies on a customized page. */
export type PanelState = Readonly<{
  /** The card has a fixed size to fill: its body scrolls and its lists show what fits. */
  fill: boolean;
  /** Slot width in grid columns (0 on a page that keeps its default layout). */
  columns: number;
  /** Slot height in grid rows (0 on a page that keeps its default layout). */
  rows: number;
}>;

const NATURAL: PanelState = { fill: false, columns: 0, rows: 0 };
const PanelContext = createContext<PanelState>(NATURAL);

export const PanelProvider = PanelContext.Provider;

export function usePanel(): PanelState {
  return useContext(PanelContext);
}

/**
 * How many rows of a known height to show. A card in its default place shows
 * `natural` rows; a card that fills a slot shows as many as its body has room
 * for, so making the card taller lengthens the list. Attach the returned ref
 * to the element whose height is the room available.
 *
 * `reserve` is the height taken by anything else inside that element.
 */
export function useFitCount(rowHeight: number, natural: number, reserve = 0) {
  const { fill } = usePanel();
  const [fit, setFit] = useState<number | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element || !fill) return;
    const measure = () => setFit(Math.max(1, Math.floor((element.clientHeight - reserve) / rowHeight)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fill, rowHeight, reserve]);
  return [ref, fill && fit !== null ? fit : natural] as const;
}
```

## Ek D. `Workspace.tsx`

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, GripHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useMediaQuery } from "@/components/charts/use-coarse-pointer";
import { Button } from "@/components/ui/button";
import { MotionMenuPopup, ReleaseMenu } from "@/components/ui/motion-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { motionScrollBehavior, useMotionAllowed } from "@/hooks/use-motion-allowed";
import type { TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cubicBezier, motionCurve, motionDuration } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LIMITS,
  MAX_GRID_ROWS,
  WORKSPACE_COLUMNS,
  WORKSPACE_DESKTOP_QUERY,
  WORKSPACE_GAP,
  WORKSPACE_ROW_STEP,
  fitHeights,
  nudgeCard,
  packLayout,
  parseLayout,
  readingOrder,
  serializeLayout,
  type CardLimits,
  type LayoutChange,
  type LayoutItem,
  type WorkspaceLayout,
} from "./layout-model";
import { PanelProvider, type PanelState } from "./panel";
import { useLayoutGesture, type GesturePreview, type GestureRelease } from "./use-layout-gesture";
import styles from "./workspace.module.css";

/** A card a page offers for arranging. */
export type WorkspaceCard = Partial<CardLimits> & {
  /** Names the card in its move, resize and menu controls. */
  label: string;
  /**
   * The card keeps the height of its content instead of filling a slot: it
   * can be moved and made wider or narrower, and its height follows. For
   * strips of figures and other blocks whose content cannot scroll or stretch.
   */
  hug?: boolean;
};

const STORAGE_PREFIX = "hisse.layout.";
const SAVED_EVENT = "workspace-layout-saved";
const DESTINATION = "destination";
const GLIDE_EASING = cubicBezier(motionCurve.easeOut);
const GRID_STYLE = {
  "--grid-columns": WORKSPACE_COLUMNS,
  "--grid-gap": `${WORKSPACE_GAP}px`,
  "--row-step": `${WORKSPACE_ROW_STEP}px`,
} as CSSProperties;
const adjustments = [
  { label: "dashboard.moveUp", key: "ArrowUp", kind: "move", x: 0, y: -1 },
  { label: "dashboard.moveDown", key: "ArrowDown", kind: "move", x: 0, y: 1 },
  { label: "dashboard.moveLeft", key: "ArrowLeft", kind: "move", x: -1, y: 0 },
  { label: "dashboard.moveRight", key: "ArrowRight", kind: "move", x: 1, y: 0 },
  { label: "dashboard.narrower", key: "ArrowLeft", kind: "resize", x: -1, y: 0 },
  { label: "dashboard.wider", key: "ArrowRight", kind: "resize", x: 1, y: 0 },
  { label: "dashboard.shorter", key: "ArrowUp", kind: "resize", x: 0, y: -1 },
  { label: "dashboard.taller", key: "ArrowDown", kind: "resize", x: 0, y: 1 },
] as const satisfies readonly { label: TranslationKey; key: string; kind: LayoutChange; x: number; y: number }[];

type Control = LayoutChange | "options";
/** `layout` is null only while the page's default arrangement is being measured. */
type Edit = { layout: WorkspaceLayout | null; status: "unchanged" | "changed" | "reset" };
/** Layouts the browser refused to store stay usable until the page is left. */
const sessionLayouts = new Map<string, { raw: string | null; storageAtFailure: string | null }>();

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SAVED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SAVED_EVENT, onChange);
  };
}

function slotStyle({ x, y, w, h }: LayoutItem, order: number): CSSProperties {
  return { "--column": x + 1, "--row": y + 1, "--columns": w, "--rows": h, "--order": order } as CSSProperties;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/** How far a glide still in flight has the element displaced. */
function displacement(element: HTMLElement): [number, number] {
  const [x = 0, y = 0] = getComputedStyle(element).translate.split(" ").map(Number.parseFloat);
  return [x || 0, y || 0];
}

type WorkspaceState = {
  cards: Readonly<Record<string, WorkspaceCard>>;
  grid: RefObject<HTMLDivElement | null>;
  /** A saved or draft layout is in effect, on any screen. */
  customized: boolean;
  /** That layout is laid out on the desktop grid (below it the cards stack in reading order). */
  positioned: boolean;
  editing: boolean;
  base: WorkspaceLayout | null;
  preview: GesturePreview | null;
  /** Where each card is drawn; a card being dragged stays in its starting slot. */
  slots: ReadonlyMap<string, LayoutItem>;
  order: ReadonlyMap<string, number>;
  landing: LayoutItem | undefined;
  helpId: string;
  limits: (id: string) => CardLimits;
  gesture: ReturnType<typeof useLayoutGesture>;
  nudge: (id: string, kind: LayoutChange, x: number, y: number, control: Control) => void;
  canNudge: (id: string, kind: LayoutChange, x: number, y: number) => boolean;
  reportHeight: (id: string, rows: number) => void;
  absent: ReadonlySet<string>;
  reportPresence: (id: string, present: boolean) => void;
  startEditing: () => void;
  closeEditor: () => void;
  resetLayout: () => void;
  saveLayout: () => void;
  customizeButton: RefObject<HTMLButtonElement | null>;
  saveButton: RefObject<HTMLButtonElement | null>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

function useWorkspace(): WorkspaceState {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace parts must be rendered inside <Workspace>.");
  return workspace;
}

/**
 * Lets a page's cards be moved and resized, Shopify-dashboard style. The page
 * keeps its own markup: every card sits in a `<Tile>`, wrappers that only
 * arrange tiles are `<TileGroup>`s, and all of it is inside a `<WorkspaceGrid>`.
 * Until the visitor saves a layout the page renders exactly as written. With a
 * layout the same elements are placed on a grid (the groups dissolve), so cards
 * keep their state when the mode changes.
 *
 * `page` names the saved layout; views that share a name share a layout.
 */
export function Workspace({
  page,
  cards,
  children,
  storageKey = STORAGE_PREFIX + page,
}: {
  page: string;
  cards: Readonly<Record<string, WorkspaceCard>>;
  children: ReactNode;
  storageKey?: string;
}) {
  const { t } = useLocale();
  const desktop = useMediaQuery(WORKSPACE_DESKTOP_QUERY);
  const motionAllowed = useMotionAllowed();
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      const value = readStorage(storageKey);
      const session = sessionLayouts.get(storageKey);
      return session?.storageAtFailure === value ? session.raw : value;
    },
    () => null,
  );
  const [edit, setEdit] = useState<Edit | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [absent, setAbsent] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const customizeButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const measuring = useRef(false);
  const shown = useRef<{ width: number; slots: Map<string, LayoutItem> } | null>(null);
  const glides = useRef(new Map<string, Animation>());
  const released = useRef<GestureRelease | null>(null);
  const control = useRef<{ id: string; kind: Control; reveal: boolean } | null>(null);
  const helpId = useId();

  const ids = useMemo(() => Object.keys(cards), [cards]);
  const limits = (id: string): CardLimits => {
    const card = cards[id];
    // A card that hugs its content is as tall as that content, whatever it is.
    if (card?.hug) return { minW: card.minW ?? DEFAULT_LIMITS.minW, minH: 1, maxH: MAX_GRID_ROWS, hug: true };
    return {
      minW: card?.minW ?? DEFAULT_LIMITS.minW,
      minH: card?.minH ?? DEFAULT_LIMITS.minH,
      maxH: card?.maxH ?? DEFAULT_LIMITS.maxH,
    };
  };
  const hugging = new Map([...heights].filter(([id]) => cards[id]?.hug));
  const saved = parseLayout(stored, ids, limits);
  const editing = desktop && edit !== null;
  const draft = editing ? edit.layout : saved;
  // A card with nothing to show (no sector to compare with, say) gives up its slot until it has.
  const missing = draft && absent.size > 0 ? draft.filter(({ id }) => absent.has(id)) : [];
  const present = draft && missing.length > 0 ? packLayout(draft.filter(({ id }) => !absent.has(id))) : draft;
  // Cards that hug their content report their height once they are on screen.
  const base = present && fitHeights(present, hugging);

  function commit(layout: WorkspaceLayout, id: string, kind: Control, reveal: boolean) {
    control.current = { id, kind, reveal };
    setEdit({ layout: [...layout, ...missing], status: "changed" });
    const item = layout.find((entry) => entry.id === id);
    if (item) {
      setAnnouncement(t("dashboard.layoutPosition", {
        card: cards[id]?.label ?? id,
        column: item.x + 1,
        row: item.y + 1,
        width: item.w,
        height: item.h,
      }));
    }
  }

  const gesture = useLayoutGesture(grid, editing, limits, (release) => {
    released.current = release;
    if (release.changed) commit(release.layout, release.id, release.kind, false);
  });
  const preview = base ? gesture.preview : null;
  const layout = preview?.layout ?? base;
  const customized = layout !== null;
  const positioned = desktop && customized;
  const slots = new Map<string, LayoutItem>();
  const order = new Map<string, number>();
  if (customized) {
    for (const item of layout) slots.set(item.id, preview?.id === item.id ? base?.find(({ id }) => id === item.id) ?? item : item);
    readingOrder(base ?? layout).forEach((item, index) => order.set(item.id, index));
  }
  const landing = positioned && preview ? layout.find(({ id }) => id === preview.id) : undefined;
  if (landing) slots.set(DESTINATION, landing);

  // Runs after every render: cards glide from where they were on screen to their new slots.
  useLayoutEffect(() => {
    const container = grid.current;
    if (!container || measuring.current) return;
    const before = shown.current;
    const release = released.current;
    const focus = control.current;
    released.current = null;
    control.current = null;
    const width = container.offsetWidth;
    shown.current = positioned ? { width, slots } : null;

    const used = focus && container.querySelector<HTMLElement>(`[data-tile="${focus.id}"] [data-control="${focus.kind}"]`);
    if (used) {
      if (document.activeElement !== used) used.focus({ preventScroll: true });
      if (focus.reveal) used.closest("[data-tile]")?.scrollIntoView({ block: "nearest", behavior: motionScrollBehavior() });
    }

    if (!positioned || !motionAllowed || (before && before.width !== width)) {
      for (const glide of glides.current.values()) glide.cancel();
      glides.current.clear();
      return;
    }
    if (!before) return;
    const columnStep = (width + WORKSPACE_GAP) / WORKSPACE_COLUMNS;
    const pixels = ({ w, h }: LayoutItem) => ({ width: `${w * columnStep - WORKSPACE_GAP}px`, height: `${h * WORKSPACE_ROW_STEP - WORKSPACE_GAP}px` });
    for (const [key, slot] of slots) {
      const previous = before.slots.get(key);
      if (!previous) continue;

      const dropped = release?.id === key ? release : null;
      const needsResize = key === DESTINATION && (previous.w !== slot.w || previous.h !== slot.h);
      if (!dropped && !needsResize && previous.x === slot.x && previous.y === slot.y) continue;

      const element = container.querySelector<HTMLElement>(`[data-tile="${key}"]`);
      if (!element) continue;

      const flight = glides.current.get(key);
      let [x, y] = flight?.playState === "running" ? displacement(element) : [0, 0];
      x += (previous.x - slot.x) * columnStep;
      y += (previous.y - slot.y) * WORKSPACE_ROW_STEP;
      if (dropped?.kind === "move") {
        x += dropped.dx;
        y += dropped.dy;
      }
      const resized = dropped?.kind === "resize"
        ? { width: `${dropped.width}px`, height: `${dropped.height}px` }
        : needsResize ? pixels(previous) : null;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && !resized) continue;

      flight?.cancel();
      const lifted = dropped ? { zIndex: 3 } : null;
      const glide = element.animate(
        [
          { translate: `${x}px ${y}px`, ...resized, ...lifted },
          { translate: "0px 0px", ...(resized && pixels(slot)), ...lifted },
        ],
        {
          duration: key === DESTINATION ? motionDuration.press : dropped ? motionDuration.popover : motionDuration.move,
          easing: GLIDE_EASING,
        },
      );
      glides.current.set(key, glide);
      glide.onfinish = () => {
        if (glides.current.get(key) === glide) glides.current.delete(key);
      };
    }
  });

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (editing ? saveButton : customizeButton).current?.focus({ preventScroll: true });
  }, [editing]);

  /** The page's own arrangement, read from the screen: each card where it is and as large as it is. */
  function measureDefault(): WorkspaceLayout | null {
    const container = grid.current;
    const bounds = container?.getBoundingClientRect();
    if (!container || !bounds || bounds.width === 0) return null;
    const columnStep = (bounds.width + WORKSPACE_GAP) / WORKSPACE_COLUMNS;
    const boxes: LayoutItem[] = [];
    for (const id of ids) {
      const box = container.querySelector<HTMLElement>(`[data-tile="${id}"]`)?.getBoundingClientRect();
      if (!box || box.width === 0) continue;
      const { minW, minH, maxH } = limits(id);
      const x = clamp(Math.round((box.left - bounds.left) / columnStep), 0, WORKSPACE_COLUMNS - 1);
      const rows = Math.ceil((box.height + WORKSPACE_GAP) / WORKSPACE_ROW_STEP);
      boxes.push({
        id,
        x,
        y: Math.max(0, Math.round((box.top - bounds.top) / WORKSPACE_ROW_STEP)),
        w: clamp(Math.round((box.width + WORKSPACE_GAP) / columnStep), Math.min(minW, WORKSPACE_COLUMNS - x), WORKSPACE_COLUMNS - x),
        h: clamp(rows, minH, maxH),
      });
    }
    // Reading it back appends any card that is not on screen and applies the size limits.
    return boxes.length > 0 ? parseLayout(serializeLayout(packLayout(boxes)), ids, limits) : null;
  }

  function startEditing() {
    const start = saved ?? measureDefault();
    if (!start) return;
    moveFocus.current = true;
    setEdit({ layout: start, status: "unchanged" });
  }

  function closeEditor() {
    gesture.cancel();
    moveFocus.current = true;
    setEdit(null);
    setAnnouncement("");
  }

  function resetLayout() {
    gesture.cancel();
    // Lay the page out as written for a moment to learn where its cards go by default.
    measuring.current = true;
    flushSync(() => setEdit({ layout: null, status: "reset" }));
    const natural = measureDefault();
    measuring.current = false;
    setEdit(natural ? { layout: natural, status: "reset" } : null);
    setAnnouncement("");
  }

  function saveLayout() {
    if (!edit) return;
    if (edit.status === "unchanged" || base === null) {
      closeEditor();
      return;
    }
    const raw = edit.status === "reset" ? null : serializeLayout([...base, ...missing]);
    try {
      if (raw === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, raw);
      sessionLayouts.delete(storageKey);
      toast.success(t("dashboard.layoutSaved"));
    } catch {
      sessionLayouts.set(storageKey, { raw, storageAtFailure: readStorage(storageKey) });
      toast.warning(t("dashboard.layoutSaveError"));
    }
    window.dispatchEvent(new Event(SAVED_EVENT));
    closeEditor();
  }

  const workspace: WorkspaceState = {
    cards,
    grid,
    customized,
    positioned,
    editing,
    base,
    preview,
    slots,
    order,
    landing,
    helpId,
    limits,
    gesture,
    nudge(id, kind, x, y, used) {
      if (!base || preview) return;
      const next = nudgeCard(base, id, kind, x, y, limits);
      if (next !== base) commit(next, id, used, true);
    },
    canNudge: (id, kind, x, y) => base !== null && nudgeCard(base, id, kind, x, y, limits) !== base,
    reportHeight(id, rows) {
      setHeights((current) => (current.get(id) === rows ? current : new Map(current).set(id, rows)));
    },
    absent,
    reportPresence(id, shown) {
      setAbsent((current) => {
        if (current.has(id) !== shown) return current;
        const next = new Set(current);
        if (shown) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    startEditing,
    closeEditor,
    resetLayout,
    saveLayout,
    customizeButton,
    saveButton,
  };

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="sr-only" role="status">{announcement}</div>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * The Customize button, and Reset / Cancel / Save while arranging. Place it in
 * the page's header. Arranging needs a wide screen, so it is hidden below `lg`.
 * `compact` leaves out the written hint, for rows without room for it.
 */
export function WorkspaceControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useLocale();
  const { editing, helpId, startEditing, closeEditor, resetLayout, saveLayout, customizeButton, saveButton } = useWorkspace();
  return (
    <div className={cn("hidden items-center gap-4 lg:flex", className)}>
      {editing ? (
        <>
          {compact ? null : (
            <p className="max-w-80 text-right text-xs leading-4 text-pretty text-muted-foreground xl:max-w-[30rem]">
              {t("dashboard.layoutHint")}
            </p>
          )}
          <span className="sr-only" id={helpId}>{t("dashboard.layoutKeyboard")}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetLayout}>{t("dashboard.resetLayout")}</Button>
            <Button variant="outline" size="sm" onClick={closeEditor}>{t("dashboard.cancelLayout")}</Button>
            <Button ref={saveButton} size="sm" onClick={saveLayout}>{t("dashboard.saveLayout")}</Button>
          </div>
        </>
      ) : (
        <Button ref={customizeButton} variant="outline" size="sm" onClick={startEditing}>
          <Pencil aria-hidden="true" />
          {t("dashboard.customize")}
        </Button>
      )}
    </div>
  );
}

/**
 * Holds the page's tiles. `className` lays them out by default; once a layout
 * is in effect the grid takes over and that class is dropped.
 */
export function WorkspaceGrid({ className, children }: { className?: string; children: ReactNode }) {
  const { grid, customized, positioned, editing, preview, landing } = useWorkspace();
  return (
    <div
      ref={grid}
      style={GRID_STYLE}
      className={cn(customized ? styles.custom : className, positioned && styles.positioned, editing && styles.editing)}
      data-gesture={preview?.kind}
    >
      {landing && <div className={styles.destination} data-tile={DESTINATION} style={slotStyle(landing, 0)} aria-hidden="true" />}
      {children}
    </div>
  );
}

/**
 * A wrapper that only arranges tiles (a row, a column, a titled section). It
 * dissolves once a layout is in effect, so its tiles land on the grid.
 */
export function TileGroup({
  as: Element = "div",
  className,
  children,
  ...props
}: {
  as?: "div" | "section";
  className?: string;
  children: ReactNode;
  id?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Element {...props} data-tile-group="" className={className}>
      {children}
    </Element>
  );
}

/** Spread on headings and other chrome that belongs to the default layout only. */
export const DEFAULT_LAYOUT_ONLY = { "data-default-layout-only": "" } as const;

/** Card-shaped stand-in for a tile that has not been scrolled near yet. */
function TilePlaceholder({ minHeight }: { minHeight: number }) {
  return (
    <div aria-hidden className="card-surface flex flex-col overflow-hidden" style={{ minHeight }}>
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="space-y-3.5 p-4">
        {[46, 62, 38, 56].map((width) => (
          <div key={width} className="flex items-center justify-between gap-6">
            <Skeleton className="h-3" style={{ width: `${width}%` }} />
            <Skeleton className="h-3 w-14 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One card of the page. By default it is an invisible box around the card
 * (`className` places it in the page's own layout, and the card fills it).
 * On a customized page it is the card's slot, with the handles while arranging.
 *
 * `lazy` mounts the card only once it nears the viewport, holding its place
 * with a placeholder `placeholderHeight` tall until then.
 */
export function Tile({
  id,
  className,
  lazy = false,
  placeholderHeight = 320,
  children,
}: {
  id: string;
  className?: string;
  lazy?: boolean;
  placeholderHeight?: number;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const workspace = useWorkspace();
  const { cards, customized, positioned, editing, base, preview, gesture, helpId, reportHeight, reportPresence } = workspace;
  const element = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(!lazy);
  const card = cards[id];
  const title = card?.label ?? id;
  const hug = Boolean(card?.hug);
  const slot = workspace.slots.get(id);
  const item = base?.find((entry) => entry.id === id);
  // A hugging card that must span the page has nothing left to resize.
  const resizable = !hug || workspace.limits(id).minW < WORKSPACE_COLUMNS;
  const fill = positioned && !hug && slot !== undefined;
  const columns = slot?.w ?? 0;
  const rows = slot?.h ?? 0;
  const panel = useMemo<PanelState>(() => ({ fill, columns, rows }), [fill, columns, rows]);

  useEffect(() => {
    const tile = element.current;
    if (!tile || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(tile);
    return () => observer.disconnect();
  }, [seen]);

  // Whether the card rendered anything: the tile's other children are its own controls.
  useLayoutEffect(() => {
    const tile = element.current;
    if (!tile) return;
    const check = () => reportPresence(id, Array.from(tile.children).some((child) => !child.hasAttribute("data-tile-chrome")));
    check();
    const observer = new MutationObserver(check);
    observer.observe(tile, { childList: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportPresence only forwards to a state setter
  }, [id]);

  const measured = positioned && hug;
  useLayoutEffect(() => {
    const tile = element.current;
    if (!tile || !measured) return;
    const report = () => {
      if (tile.offsetHeight > 0) reportHeight(id, Math.ceil((tile.offsetHeight + WORKSPACE_GAP) / WORKSPACE_ROW_STEP));
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(tile);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportHeight only forwards to a state setter
  }, [id, measured]);

  const handle = (kind: LayoutChange) => {
    if (!item || !base) return null;
    const name = t(kind === "move" ? "dashboard.moveCard" : "dashboard.resizeCard", { card: title });
    return (
      <button
        type="button"
        className={cn(styles.handle, kind === "move" ? styles.move : styles.resize)}
        data-control={kind}
        data-tile-chrome=""
        aria-label={name}
        aria-describedby={helpId}
        title={name}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => gesture.start(event, item, kind, base)}
        onPointerMove={gesture.move}
        onPointerUp={gesture.end}
        onPointerCancel={gesture.cancelPointer}
        onLostPointerCapture={gesture.cancelPointer}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          const adjustment = adjustments.find(({ key, kind: target }) => key === event.key && target === kind);
          if (!adjustment) return;
          event.preventDefault();
          workspace.nudge(id, kind, adjustment.x, adjustment.y, kind);
        }}
      >
        {kind === "move" ? <GripHorizontal aria-hidden="true" size={15} /> : (
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M22.5 9v6.5a7 7 0 0 1-7 7H9" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <div
      ref={element}
      data-tile={id}
      data-hug={hug ? "" : undefined}
      data-absent={workspace.absent.has(id) ? "" : undefined}
      data-gesture={preview?.id === id ? preview.kind : undefined}
      className={cn(styles.tile, !customized && className)}
      style={slot ? slotStyle(slot, workspace.order.get(id) ?? 0) : undefined}
    >
      <PanelProvider value={panel}>{seen ? children : <TilePlaceholder minHeight={customized ? 0 : placeholderHeight} />}</PanelProvider>
      {editing && item && base && (
        <>
          <div className={styles.grabber} data-tile-chrome="">
            {handle("move")}
            <ReleaseMenu trigger={
              <button
                type="button"
                className={styles.handle}
                data-control="options"
                aria-label={t("dashboard.cardOptions", { card: title })}
                title={t("dashboard.cardOptions", { card: title })}
              >
                <Ellipsis aria-hidden="true" size={15} />
              </button>
            }>
              <Menu.Portal>
                <Menu.Positioner align="center" sideOffset={6} className="z-[90]">
                  <MotionMenuPopup className="min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                    {adjustments.filter(({ kind, y }) => kind === "move" || (resizable && (!hug || y === 0))).map((adjustment) => (
                      <Menu.Item
                        key={adjustment.label}
                        disabled={!workspace.canNudge(id, adjustment.kind, adjustment.x, adjustment.y)}
                        className="cursor-default rounded-sm px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted"
                        onClick={() => workspace.nudge(id, adjustment.kind, adjustment.x, adjustment.y, "options")}
                      >
                        {t(adjustment.label)}
                      </Menu.Item>
                    ))}
                  </MotionMenuPopup>
                </Menu.Positioner>
              </Menu.Portal>
            </ReleaseMenu>
          </div>
          {resizable && handle("resize")}
        </>
      )}
    </div>
  );
}
```

## Ek E. `workspace.module.css`

```css
/* By default a tile is an invisible box: it takes the place its card had and the card fills it. */
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* Matches the card surface, so outlines follow its corners. */
  border-radius: calc(var(--radius) * 1.8);
}

.tile > * {
  flex: 1 0 auto;
  min-width: 0;
}

.tile:focus-within {
  z-index: 1;
}

/* A card that rendered nothing leaves no box behind. */
.tile[data-absent] {
  display: none;
}

/* A layout is in effect: wrappers dissolve and the tiles stack in reading order. */
.custom {
  display: flex;
  flex-direction: column;
  gap: var(--grid-gap);
}

.custom [data-tile-group] {
  display: contents;
}

.custom [data-default-layout-only] {
  display: none;
}

.custom .tile {
  order: var(--order);
  /* Spacing a dissolved group gave its children (`space-y-*`) no longer applies. */
  margin-block: 0;
  /* Clear of the sticky site header when a link scrolls to the card. */
  scroll-margin-block-start: 6rem;
}

.editing .tile {
  outline: 1px solid transparent;
  outline-offset: 2px;
  transition: outline-color var(--motion-press) var(--motion-ease-out),
    box-shadow var(--motion-popover) var(--motion-ease-out);
}

.editing .tile:hover,
.editing .tile:focus-within {
  outline-color: color-mix(in oklab, var(--foreground) 26%, transparent);
}

.handle {
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: var(--muted-foreground);
  touch-action: none;
  user-select: none;
  transition: color var(--motion-press) var(--motion-ease-out),
    background-color var(--motion-press) var(--motion-ease-out);
}

.handle:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}

/* Sits on the card's top edge, clear of its title and actions. */
.grabber {
  position: absolute;
  z-index: 2;
  inset-block-start: -13px;
  inset-inline-start: 50%;
  display: flex;
  flex: none;
  translate: -50% 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  box-shadow: 0 1px 3px rgb(0 0 0 / 14%);
}

.grabber .handle {
  width: 28px;
  height: 24px;
}

.grabber .handle:hover,
.grabber .handle:focus-visible,
.grabber .handle[data-popup-open] {
  background: var(--muted);
  color: var(--foreground);
}

.move {
  cursor: grab;
}

/* Traces the card's bottom-right corner. */
.resize {
  position: absolute;
  z-index: 2;
  inset-block-end: -5px;
  inset-inline-end: -5px;
  flex: none;
  /* The glyph stays on the corner whatever the size of the hit area. */
  place-items: end;
  width: 28px;
  height: 28px;
  border-radius: calc(var(--radius) * 1.8);
  cursor: nwse-resize;
}

.resize:hover,
.resize:focus-visible,
.tile[data-gesture="resize"] .resize {
  color: var(--primary);
}

/* Touch needs larger targets than a mouse pointer. */
@media (pointer: coarse) {
  .grabber {
    inset-block-start: -17px;
  }

  .grabber .handle {
    width: 36px;
    height: 32px;
  }

  .resize {
    width: 40px;
    height: 40px;
  }
}

@media (min-width: 64rem) {
  .positioned {
    display: grid;
    grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
    grid-auto-rows: var(--row-step);
    gap: 0 var(--grid-gap);
    margin-block-end: calc(-1 * var(--grid-gap));
  }

  .positioned .tile,
  .destination {
    grid-column: var(--column) / span var(--columns);
    grid-row: var(--row) / span var(--rows);
    margin-block-end: var(--grid-gap);
  }

  /* The card fills its slot and scrolls inside it. */
  .positioned .tile > * {
    flex: 1 1 0;
    min-height: 0;
  }

  /* A card that hugs its content sets the height of its slot, not the other way round. */
  .positioned .tile[data-hug] {
    align-self: start;
  }

  .positioned .tile[data-hug] > * {
    flex: 0 0 auto;
  }

  .destination {
    border: 1.5px dashed color-mix(in oklab, var(--primary) 70%, transparent);
    border-radius: calc(var(--radius) * 1.8);
    background: color-mix(in oklab, var(--primary) 9%, transparent);
    pointer-events: none;
  }

  .positioned[data-gesture] {
    user-select: none;
  }

  .editing .tile[data-gesture] {
    z-index: 4;
    outline-color: var(--primary);
    box-shadow: 0 18px 40px -14px rgb(0 0 0 / 40%), 0 4px 12px rgb(0 0 0 / 16%);
  }

  .tile[data-gesture="move"] {
    transform: translate3d(var(--offset-x, 0px), var(--offset-y, 0px), 0);
    will-change: transform;
  }

  .tile[data-gesture="move"] .move {
    cursor: grabbing;
  }

  .positioned .tile[data-gesture="resize"] {
    align-self: start;
    width: calc(100% + var(--offset-x, 0px));
    height: calc(100% - var(--grid-gap) + var(--offset-y, 0px));
  }

  .positioned .tile[data-hug][data-gesture="resize"] {
    height: auto;
  }

  /* Without motion the card stays put and the outline alone shows where it will land. */
  @media (prefers-reduced-motion: reduce) {
    .tile[data-gesture="move"] {
      transform: none;
    }

    .positioned .tile[data-gesture="resize"] {
      align-self: stretch;
      width: auto;
      height: auto;
    }
  }
}
```

## Ek F. `layout-model.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LIMITS,
  MAX_GRID_ROWS,
  WORKSPACE_COLUMNS,
  fitHeights,
  moveCard,
  nudgeCard,
  packLayout,
  parseLayout,
  readingOrder,
  resizeCard,
  serializeLayout,
  type CardLimits,
  type WorkspaceLayout,
} from "./layout-model.ts";

/** The home page's cards: a wide chart over the news, beside two narrower lists. */
const CARD_IDS = ["index", "watchlist", "breadth", "events"];
const CARD_LIMITS: Record<string, CardLimits> = {
  index: { minW: 3, minH: 15, maxH: 28 },
  watchlist: { minW: 2, minH: 10, maxH: 28 },
  breadth: { minW: 2, minH: 8, maxH: 28 },
  events: { minW: 2, minH: 7, maxH: 28 },
};
const limits = (id: string) => CARD_LIMITS[id] ?? DEFAULT_LIMITS;
const DEFAULT_LAYOUT: WorkspaceLayout = [
  { id: "index", x: 0, y: 0, w: 4, h: 15 },
  { id: "watchlist", x: 4, y: 0, w: 2, h: 10 },
  { id: "breadth", x: 4, y: 10, w: 2, h: 16 },
  { id: "events", x: 0, y: 15, w: 4, h: 13 },
];
const parse = (raw: string | null) => parseLayout(raw, CARD_IDS, limits);

function card(layout: WorkspaceLayout, id: string) {
  const item = layout.find((entry) => entry.id === id);
  assert.ok(item, `Missing ${id}`);
  return item;
}

/** Inside the grid, within the size limits, no overlaps, and no card with empty rows above it. */
function assertFits(layout: WorkspaceLayout) {
  assert.deepEqual(layout.map(({ id }) => id), [...CARD_IDS]);
  for (const [index, item] of layout.entries()) {
    const { minW, minH, maxH } = limits(item.id);
    assert.ok(item.x >= 0 && item.x + item.w <= WORKSPACE_COLUMNS);
    assert.ok(item.y >= 0 && item.y + item.h <= MAX_GRID_ROWS);
    assert.ok(item.w >= minW && item.h >= minH && item.h <= maxH);
    for (const other of layout.slice(index + 1)) {
      const horizontalOverlap = item.x < other.x + other.w && other.x < item.x + item.w;
      const verticalOverlap = item.y < other.y + other.h && other.y < item.y + item.h;
      assert.ok(!horizontalOverlap || !verticalOverlap, `${item.id} overlaps ${other.id}`);
    }
    const rests = item.y === 0 || layout.some((other) =>
      other.id !== item.id && other.y + other.h === item.y && item.x < other.x + other.w && other.x < item.x + item.w);
    assert.ok(rests, `${item.id} has a gap above it`);
  }
}

test("the default layout fits and sorts in mobile reading order", () => {
  assertFits(DEFAULT_LAYOUT);
  assert.deepEqual(readingOrder([...DEFAULT_LAYOUT].reverse()).map(({ id }) => id), [...CARD_IDS]);
  assert.deepEqual(parse(serializeLayout(DEFAULT_LAYOUT)), DEFAULT_LAYOUT);
});

test("a moved card takes its cell and the others close every gap", () => {
  const moved = moveCard(DEFAULT_LAYOUT, "watchlist", 3, 5);
  assertFits(moved);
  // Nothing sits above column 3, so the card rises to the top and the chart yields.
  assert.deepEqual(card(moved, "watchlist"), { ...card(DEFAULT_LAYOUT, "watchlist"), x: 3, y: 0 });
  assert.equal(card(moved, "index").y, 10);
  assert.equal(card(moved, "breadth"), card(DEFAULT_LAYOUT, "breadth"));
  assert.equal(card(moved, "events").y, 25);
  assert.equal(card(DEFAULT_LAYOUT, "index").y, 0);

  for (const id of CARD_IDS) {
    for (let x = 0; x < WORKSPACE_COLUMNS; x++) {
      for (let y = 0; y < 40; y++) assertFits(moveCard(DEFAULT_LAYOUT, id, x, y));
    }
  }
});

test("stacked cards swap once the dragged edge crosses the neighbour's middle", () => {
  // Downward the bottom edge leads: the breadth card spans rows 10 to 26.
  assert.equal(moveCard(DEFAULT_LAYOUT, "watchlist", 4, 8), DEFAULT_LAYOUT);
  const lowered = moveCard(DEFAULT_LAYOUT, "watchlist", 4, 9);
  assert.equal(card(lowered, "breadth").y, 0);
  assert.equal(card(lowered, "watchlist").y, 16);
  assertFits(lowered);

  // Upward the top edge leads: the watchlist spans rows 0 to 10.
  assert.equal(moveCard(DEFAULT_LAYOUT, "breadth", 4, 5), DEFAULT_LAYOUT);
  const raised = moveCard(DEFAULT_LAYOUT, "breadth", 4, 4);
  assert.deepEqual(raised, lowered);

  // The same holds for a card arriving from another column.
  assert.equal(moveCard(DEFAULT_LAYOUT, "events", 0, 8), DEFAULT_LAYOUT);
  const promoted = moveCard(DEFAULT_LAYOUT, "events", 0, 7);
  assert.equal(card(promoted, "events").y, 0);
  assert.equal(card(promoted, "index").y, 13);
  assert.equal(card(promoted, "watchlist"), card(DEFAULT_LAYOUT, "watchlist"));
  assertFits(promoted);
});

test("moving clamps to the grid and ignores values that are not numbers", () => {
  const moved = moveCard(DEFAULT_LAYOUT, "events", 999, 999);
  const events = card(moved, "events");
  assert.equal(events.x + events.w, WORKSPACE_COLUMNS);
  // Far below everything, it rests on the tallest card in its columns.
  assert.equal(events.y, 26);
  assertFits(moved);
  assert.equal(moveCard(DEFAULT_LAYOUT, "index", Number.NaN, Infinity), DEFAULT_LAYOUT);
  assert.equal(moveCard(DEFAULT_LAYOUT, "index", -5, -5), DEFAULT_LAYOUT);
});

test("resizing keeps the top left still and pushes other cards down", () => {
  const index = card(DEFAULT_LAYOUT, "index");
  const resized = resizeCard(DEFAULT_LAYOUT, "index", 100, 18, limits);

  assertFits(resized);
  assert.deepEqual(card(resized, "index"), { ...index, w: WORKSPACE_COLUMNS, h: 18 });
  assert.equal(card(resized, "watchlist").y, 18);
  assert.equal(card(resized, "breadth").y, 28);
  assert.equal(card(resized, "events").y, 18);
  assert.equal(card(DEFAULT_LAYOUT, "watchlist").y, 0);
  assert.deepEqual(parse(serializeLayout(resized)), resized);
});

test("resizing obeys the limits and lets the cards below rise into freed rows", () => {
  const narrowed = resizeCard(DEFAULT_LAYOUT, "index", -1, -1, limits);
  assert.deepEqual(card(narrowed, "index"), { ...card(DEFAULT_LAYOUT, "index"), w: 3 });
  assert.equal(card(narrowed, "watchlist"), card(DEFAULT_LAYOUT, "watchlist"));
  assertFits(narrowed);

  const taller = resizeCard(DEFAULT_LAYOUT, "index", 4, 20, limits);
  assert.equal(card(taller, "events").y, 20);
  assert.equal(card(resizeCard(taller, "index", 4, 16, limits), "events").y, 16);

  const stretched = resizeCard(DEFAULT_LAYOUT, "watchlist", WORKSPACE_COLUMNS, 999, limits);
  assert.equal(card(stretched, "watchlist").w, 2);
  assert.equal(card(stretched, "watchlist").h, CARD_LIMITS.watchlist.maxH);
  assert.equal(card(stretched, "breadth").y, CARD_LIMITS.watchlist.maxH);
  assertFits(stretched);
  assert.equal(resizeCard(DEFAULT_LAYOUT, "index", Number.NaN, Number.NaN, limits), DEFAULT_LAYOUT);
});

test("narrowing a card closes a gap before the layout is saved", () => {
  const moved = moveCard(DEFAULT_LAYOUT, "index", 2, 0);
  const narrower = resizeCard(moved, "events", 2, card(moved, "events").h, limits);
  assert.equal(card(narrower, "events").y, 0);
  assertFits(narrower);
  assert.deepEqual(parse(serializeLayout(narrower)), narrower);
});

test("a keyboard step always changes the layout or reports that it cannot", () => {
  assert.deepEqual(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 0, 1, limits), moveCard(DEFAULT_LAYOUT, "watchlist", 4, 9));
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 0, -1, limits), DEFAULT_LAYOUT);
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 1, 0, limits), DEFAULT_LAYOUT);
  assert.equal(card(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", -1, 0, limits), "watchlist").x, 3);
  // The lowest card in a column has nowhere further down to go.
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "breadth", "move", 0, 1, limits), DEFAULT_LAYOUT);

  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "resize", -1, 0, limits), DEFAULT_LAYOUT);
  assert.equal(card(nudgeCard(DEFAULT_LAYOUT, "watchlist", "resize", 0, 1, limits), "watchlist").h, 11);
  for (const id of CARD_IDS) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      assertFits(nudgeCard(DEFAULT_LAYOUT, id, "move", dx, dy, limits));
      assertFits(nudgeCard(DEFAULT_LAYOUT, id, "resize", dx, dy, limits));
    }
  }
});

test("invalid, empty or unsupported saved layouts use the caller's default", () => {
  for (const raw of [null, "invalid", "null", "[]", '{"version":2,"items":[]}', '{"version":1,"items":[false]}']) {
    assert.equal(parse(raw), null);
  }
});

test("saved layouts recover missing, duplicate, invalid and colliding entries", () => {
  const index = { ...card(DEFAULT_LAYOUT, "index"), w: 6 };
  const watchlist = card(DEFAULT_LAYOUT, "watchlist");
  const raw = JSON.stringify({
    version: 1,
    items: [
      { ...index, x: -1 },
      index,
      { ...index, y: 50 },
      watchlist,
      { ...card(DEFAULT_LAYOUT, "events"), y: MAX_GRID_ROWS },
      { ...card(DEFAULT_LAYOUT, "breadth"), id: "unknown" },
    ],
  });

  const layout = parse(raw);
  assert.ok(layout);
  assertFits(layout);
  assert.deepEqual(card(layout, "index"), index);
  assert.equal(card(layout, "watchlist").y, index.h);
  // The two cards without a usable entry follow at the bottom, full width.
  assert.deepEqual(card(layout, "breadth"), { id: "breadth", x: 0, y: index.h + watchlist.h, w: WORKSPACE_COLUMNS, h: 10 });
  assert.deepEqual(card(layout, "events"), { id: "events", x: 0, y: index.h + watchlist.h + 10, w: WORKSPACE_COLUMNS, h: 10 });
  assert.deepEqual(parse(serializeLayout(layout)), layout);
});

test("sizes saved outside the current limits are brought back inside them", () => {
  const raw = JSON.stringify({
    version: 1,
    items: [
      { id: "index", x: 0, y: 0, w: 1, h: 2 },
      { id: "watchlist", x: 5, y: 0, w: 1, h: 100 },
      { id: "breadth", x: 0, y: 40, w: 2, h: 8 },
      { id: "events", x: 2, y: 40, w: 2, h: 7 },
    ],
  });
  const layout = parse(raw);
  assert.ok(layout);
  assertFits(layout);
  assert.deepEqual(card(layout, "index"), { id: "index", x: 0, y: 0, w: CARD_LIMITS.index.minW, h: CARD_LIMITS.index.minH });
  assert.deepEqual(card(layout, "watchlist"), { id: "watchlist", x: 4, y: 0, w: 2, h: CARD_LIMITS.watchlist.maxH });
});

test("a saved layout with empty rows between cards is closed up", () => {
  const spread = DEFAULT_LAYOUT.map((item) => (item.id === "events" ? { ...item, y: 60 } : item.id === "index" ? { ...item, y: 4 } : item));
  assert.deepEqual(parse(serializeLayout(spread)), DEFAULT_LAYOUT);
});

test("a card the page gained since the layout was saved is appended full width", () => {
  const raw = serializeLayout(DEFAULT_LAYOUT.filter(({ id }) => id !== "events"));
  const layout = parse(raw);
  assert.ok(layout);
  assert.deepEqual(layout.map(({ id }) => id), CARD_IDS);
  assert.deepEqual(card(layout, "events"), { id: "events", x: 0, y: 26, w: WORKSPACE_COLUMNS, h: 10 });
});

test("cards that hug their content take the measured height and push the rest", () => {
  assert.equal(fitHeights(DEFAULT_LAYOUT, new Map()), DEFAULT_LAYOUT);
  assert.equal(fitHeights(DEFAULT_LAYOUT, new Map([["watchlist", 10]])), DEFAULT_LAYOUT);

  const grown = fitHeights(DEFAULT_LAYOUT, new Map([["watchlist", 13], ["missing", 4]]));
  assert.equal(card(grown, "watchlist").h, 13);
  assert.equal(card(grown, "breadth").y, 13);
  assert.equal(card(grown, "index"), card(DEFAULT_LAYOUT, "index"));

  const shrunk = fitHeights(grown, new Map([["watchlist", 3]]));
  assert.equal(card(shrunk, "breadth").y, 3);
});

test("packing closes gaps without changing the reading order", () => {
  const loose = DEFAULT_LAYOUT.map((item) => ({ ...item, y: item.y * 2 + 3 }));
  assert.deepEqual(packLayout(loose), DEFAULT_LAYOUT);
  assert.equal(packLayout(DEFAULT_LAYOUT), DEFAULT_LAYOUT);
});
```
