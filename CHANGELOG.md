# Değişiklik Günlüğü

## Yayımlanmamış

### KAP Haberleri (`/events`) baştan yazıldı

- **KAP veri hattı:** bildirimler artık KAP’ın genel listesinden (`POST /tr/api/disclosure/members/byCriteria`) döngü başına **tek istekle** alınır ve şirketlere hisse koduna göre dağıtılır. Şirket başına ~100 istek KAP’ın WAF’ına takılıyordu (tur başına 102 şirketin 100’ü “Server disconnected”); yeni tur 102 şirket için ~0,5 sn sürer, tarama aralığı 5 dk → 60 sn. Hata durumunda istek başına değil tur başına bir kez geri çekilir. Kesinti sonrası en fazla 7 gün geriye yakalar.
- **Gerçek başlıklar:** her bildirimin KAP özeti (“Tahsisli Sermaye Artırımı Kapsamında TTK 461 Raporu”), yayımlayan kurum, düzeltme ve ek dosya bilgisi saklanır; önceden yalnızca form adı (“Özel Durum Açıklaması (Genel)”) vardı. Geçmiş kayıtlar `scripts/backfill_kap_summaries.py` ile zenginleştirilir. Dedup anahtarları değişmedi (eski kayıtlarla birebir uyumlu).
- **Bildirim tam metni:** `GET /events/{id}/content` bildirimi ilk açılışta KAP’tan çekip başlık / alan / metin / tablo bloklarına çevirir (XBRL formları ve eski rapor formları) ve veritabanında önbelleğe alır; KAP’a ulaşılamazsa `503 upstream_unavailable`.
- **Kategoriler:** 7 yeni kategori (Pay Geri Alımı, Birleşme & Devralma, Pay Alım Satım, Borçlanma Aracı, Kredi Notu, Genel Kurul, Piyasa Duyurusu; migration 010). Sınıflandırma önce form adına, sonra KAP özetine bakar; “Diğer” oranı %89’dan belirgin şekilde düştü.
- **API:** `/events` çok şirketli bir bildirimi tek satır döndürür (aynı bildirim önceden 49 kez listelenebiliyordu; tüm hisseler `tickers` alanında), çoklu hisse filtresi (`ticker=THYAO,GARAN`), sıralama (`sort=newest|oldest|severity|ticker`) ve özette arama. Arama büyük/küçük harf ve Türkçe karakter duyarsızdır (“is bankasi” → “İş Bankası”). Yeni `GET /events/facets` filtre çubuğundaki sayıları verir (kategori, önem ve `ticker_facet` ile istenen hisseler; her eksen kendi filtresini yok sayar). `EventOut`’a `summary`, `tickers`, `company_name`, `publisher`, `category_code`, `is_correction`, `attachment_count` eklendi (geriye dönük uyumlu).
- **Sayfa:** gün gün gruplanan akış (Bugün / Dün / tarih), hisse–şirket önerili arama (`/` kısayolu), filtre çubuğu (aşağıda): TARİH (Bugün, Dün, Son 7/30 gün, Bu ay, Özel aralık), FİLTRELE (önem, kategori ve hisse, sayılarıyla), SIRALA (sıralama ve sayfa boyutu) ve takip listesi kısayolu; tüm durum URL’de, paylaşılabilir. Satırda saatin hemen yanında önem (“Yüksek” / “Orta”; rutin bildirimlerde boş, hisse kodları hizalı kalır), KAP özeti, şirket, form adı, yayımlayan kurum (Takasbank, Borsa İstanbul…), düzeltme ve ek dosya bilgisi. Detay panelinde bildirimin tam metni (alanlar, açıklamalar, tablolar), KAP bağlantısı, hisse sayfası, bağlantı kopyalama ve `j`/`k` ile önceki–sonraki bildirim. İlk sayfa dakikada bir kendini yeniler; KAP akışının canlı/gecikmeli durumu başlıkta. TR/EN/FR, açık/koyu tema.
- **Sınıflandırma düzeltmeleri:** devre kesici bildirimleri (“işlem sırasında … devre kesici devreye girmiştir”) artık işlem durdurma sayılıp “Yüksek” olmuyor; likidite sağlayıcılık / piyasa yapıcılık sözleşmeleri “Yeni İş” değil “Piyasa Duyurusu”.

### Filtre çubuğu (belif.tr düzeni)

- KAP Haberleri, Hisse Tarama ve Makro sayfasındaki ekonomik takvimin kutucuk kutucuk filtre alanları, belif.tr katalog sayfasındaki filtre çubuğuna çevrildi (ortak bileşen `dashboard/src/components/ui/filter-bar.tsx`): iki ince çizgi arasında tek çubuk; takvimde solda tek tıkla ulaşılan önem çipleri, sağda açılır menüler (KAP: TARİH, FİLTRELE ile önem, kategori ve hisse, SIRALA; Tarama: ENDEKS, SEKTÖR, TARAMALAR, KRİTERLER; takvim: TARİH ve durum, FİLTRELE ile ülke ve konu, SIRALA ile yön). Takvimin gün şeridi çubuğun altında aynen duruyor. Menünün kapalı hâli seçimi söyler (tek seçimde adı, fazlasında “N seçili”); ayrı “etkin filtre” çip şeridi kaldırıldı.
- FİLTRELE panelinde her eksen açılır bir alt başlık: yapışkan başlık, seçim sayısı, “Tümünü seç” (kısmi seçimde belirsiz hâl), her seçeneğin getireceği sonuç sayısı; sonuç getirmeyecek seçenek gizlenmez, sönük durur. İki eksenli panelde ikinci eksen başlığının altında katlı gelir ve panel ilk kaydırıldığında açılır. Alt şeritte panelin kendi Temizle’si ve “N … göster” düğmesi.
- Tek seçimli listeler (sıralama, tarih, endeks, sektör) fareyle seçilince kapanır, klavyeyle oklarla gezilirken açık kalır. Dışarı tıklamak ve Esc menüyü kapatır, odak menü başlığına döner; panel açıkken dışarıdaki bir bağlantıya/düğmeye ilk dokunuş yalnızca paneli kapatır. Açılan panel ekrana sığacak kadar sayfayı kaydırır; telefonda çipler kenardan kenara kayar, menüler iki sütun dizilir.

### Etkileşimli grafikler

- **Fiyat ve endeks grafikleri** (hisse Genel Bakış ve Teknik sayfaları, ana sayfadaki BIST 100) TradingView Lightweight Charts ile yeniden yazıldı (`dashboard/src/components/charts`): alan / çizgi / mum, hacim, SMA 20/50/200, Bollinger, RSI / MACD / Stokastik panelleri ve hissede XU100 ile yüzde getiri karşılaştırması. Sürükleyerek ölçüm (Shift + sürükle), ⌘/Ctrl + tekerlek ve sıkıştırmayla yakınlaştırma, sürükleyerek kaydırma, veri tablosu, PNG indirme ve tam ekran; seçimler tarayıcıda hatırlanır. Teknik sayfaya fiyat grafiği eklendi (mum, SMA 20/50, RSI ve MACD).
- **Klavye ve ekran okuyucu:** grafik Tab ile odaklanır; ←/→ çubuk çubuk gezer, Home/End ilk/son çubuğa gider, + / − yakınlaştırır, 0 sıfırlar, Esc ölçümü ya da tam ekranı kapatır. Her adım ekran okuyucuya duyurulur.
- **Doğruluk:** `/market/ticker/{t}/history` ve `/market/index/{s}` isteğe bağlı `warmup` parametresiyle dönemden önceki çubukları da döndürür (en fazla 300; verilmezse yanıt değişmez); hareketli ortalama ve RSI gibi göstergeler ilk görünen çubuktan itibaren doğrudur. Son çubuk canlı fiyatı izler, başlık ile grafik aynı fiyatı gösterir. Görünen aralığın en yüksek / en düşük etiketleri ve zaman ekseni etiketleri kenarda kesilmez.
- **Küçük grafikler** (`dashboard/src/components/charts/mini`): piyasa genişliği, al / nötr / sat oyları, ortaklık yapısı (ilk 4 ortak renkli, kalanlar gri), RSI / Stokastik / %B göstergeleri, finansal oran çubukları ve analist hedef fiyat aralığı; hepsinde fare, klavye ve dokunmayla açılan ipuçları.
- **Telefon:** dokunmatik ekranlarda hareket ipuçları (iki parmakla yakınlaştırma, yana kaydırma). Hareketli ortalamalar ve temettü tabloları 375 px ekranda sayfayı yana taşırıyordu; düzeltildi.

## 1.0.0 — 22 Eylül 2026

İlk üretim sürümü: veri doğruluğu, güvenlik, performans ve işletim tarafı baştan sona gözden geçirildi.

### Kaldırılanlar

- AI analiz raporu kaldırıldı: hisse sayfasındaki kart, `/ai/status` ve `/ai/report/*` uç noktaları (SSE akışı dahil), gece rapor worker’ı ve `ai_reports` tablosu (migration 009).
- Haberlerin AI duygu/etki etiketlemesi kaldırıldı: haber kartındaki etiket ve gerekçe satırı, `/news/{ticker}` yanıtındaki `sentiment`/`impact`/`rationale` alanları, günlük AI bütçesi, `ai_usage` tablosu ve `news_items` etiket kolonları (migration 011). Haberler Google News’ten toplanmaya devam eder.
- Proje artık hiçbir LLM sağlayıcısı kullanmıyor: `anthropic` ve `google-genai` bağımlılıkları ile `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `AI_CLASSIFIER_MODEL`, `AI_DAILY_BUDGET_USD`, `AI_NEWS_CLASSIFY_ENABLED`, `RATE_LIMIT_AI`, `AI_REPORT_*` ve `AI_NIGHTLY_BATCH_*` ayarları kalktı (`.env`’de kalmaları zararsızdır, yok sayılır).

### Veri doğruluğu

- Banka finansal tablolarında sunum birimi yalnızca ilk kolondan okunuyordu; 2026/06 rakamları 1000 kat küçük görünüyordu. Birim artık her kolon için ayrı okunur. GARAN’ın KAP eşleşmesi (“GARAN TGB”) düzeltildi.
- Canlı oranlar son 12 ay (TTM) üzerinden, en güncel çeyreğe kadar hesaplanır. FAVÖK = esas faaliyet kârı + amortisman (bankalarda boş). Veritabanındaki tarihsel oranlar aynı fonksiyonla hesaplanır (`compute_financial_ratios`).
- Hareketli ortalamalar her periyot için ayrı hesaplanır (önceden hepsi aynı değeri gösteriyordu, golden cross hiç tetiklenmiyordu). AL/SAT/NÖTR özeti TradingView’un resmî puanını kullanır.
- Grafik periyotları gerçek zaman penceresine kırpılır (1 yıllık grafik ~17 ayı kapsıyordu); 52 haftalık en yüksek/düşük, önceki kapanış ve günlük değişim düzeltildi. Pivot uç noktası artık hata vermiyor.
- Polling worker’ı günün bitmemiş barını kapanış olarak kaydetmiyor.
- Haber eşleştirmesi şirket adına göre filtrelenir (ör. “Mescid-i Aksa” artık AKSA haberi sayılmıyor); takip parametreleri temizlenir, aynı başlık tekrar kaydedilmez.
- KAP bildirimleri hisse koduna tam eşleşmeyle bağlanır; birden çok şirketi ilgilendiren bildirim her şirket için kaydedilir.
- Olay önem sınıflandırması yeniden yazıldı: rutin formlar “Bilgi”, genel ÖDA “Takip”, sermaye artırımı/temettü/geri alım/finansal rapor gibi önemli olaylar “Yüksek”.
- Şirket adları KAP resmi unvanlarından alınır; kısa adlarda Türkçe karakterler geri getirildi (ör. “Eczacibasi Ilac” → “Eczacıbaşı İlaç”).
- F/K ve PD/DD sayfanın her yerinde aynı kaynaktan (TradingView, konsolide TTM) gösterilir.

### Güvenlik

- Next.js 16.3.5’e yükseltildi (kritik RCE açığı); `npm audit` 0 açık.
- Yönetim anahtarı sabit zamanlı karşılaştırılır; production’da eksik/kısa anahtar, varsayılan veritabanı parolası veya `*` CORS ile uygulama başlamaz. `/notifications` ve `/outbox` yönetim anahtarı ister.
- Proxy arkasında her istemci kendi oran sınırı kovasını kullanır (`TRUSTED_PROXIES`, `TRUSTED_PROXY_HOPS`); site geneli varsayılan sınır (300/dk) devrede. İç hata metinleri istemciye gösterilmez; tüm hatalar Türkçe JSON döner ve `X-Request-ID` taşır.
- Next.js tarafında CSP ve production’da HSTS; proxy çerez/yetki başlıklarını backend’e iletmez, yönetim yollarını dışarı açmaz.

### Performans ve dayanıklılık

- Soğuk yanıt süreleri 7–18 sn’den çoğunlukla 0,2–2 sn’ye indi (tek TradingView taraması, paylaşılan in-flight istekler, doğru TTL’ler).
- Polling worker: advisory lock gerçekten çalışıyor, kaynak başına ayrı döngü, jitter’lı geri çekilme, SIGTERM’de temiz kapanış. KAP varsayılan tarama aralığı 5 dakika; KAP akışı tur başına bir kez indirilir.
- Bildirim outbox’ı en fazla `OUTBOX_MAX_ATTEMPTS` kez dener, eski olayları atlar, çift e-posta göndermez.

### Arayüz

- Ana sayfa bileşenlere ayrıldı; sistem sayaçları yerine piyasa genişliği ve günün en çok yükselen/düşen hisseleri gösteriliyor.
- Hisse sayfaları (Genel/Teknik/Temel/Kombine) ortak başlık ve sekmelerle birleşti; sayfa anında açılır, bölümler kendi iskeletleriyle yüklenir. Başlık günlük değişimi gösterir.
- Finansal tablolar dönem, birim ve kümülatif/çeyreklik etiketiyle; analiz karnesi “Nasıl hesaplandı?” açıklamasıyla.
- Olaylar sayfası sunucu tarafı filtre ve sayfalama; tarama ve makro sayfaları yenilendi; filtreler URL’de saklanır.
- Mobil çekmece menü, erişilebilir arama, çerezle kalıcı dil (TR/EN/FR), karanlık/açık tema, yükseliş/düşüş renkleri tek yerden (`--up`/`--down`).
- Ekonomik takvimde önem ve ülke filtresi; Türkçe kısaltmalarda bin basamağı “B” yerine “bin” (milyar ile karışmasın diye).

### Altyapı

- `docker-compose.yml` migration’ları otomatik çalıştırır (`migrate` servisi); `docker-compose.prod.yml` Caddy ile otomatik HTTPS, yalnızca 80/443 dışarı açık, kaynak ve log sınırları.
- `scripts/backup.sh` / `scripts/restore.sh`; `alembic` artık `DATABASE_URL_SYNC` kullanır (yerel geliştirmede de çalışır). Yeni migration’lar: 005 (sorgu indeksleri), 006 (bildirimler şirket başına), 007 (KAP aralığı), 008 (AI harcama kaydı), 009 (`ai_reports` kaldırıldı), 011 (`ai_usage` ve haber etiketleri kaldırıldı).
- CI: mypy, TypeScript kontrolü, migration gidiş-dönüş testi ve iki Docker imajının derlenmesi eklendi.
- Testler 88’den 589’a çıktı; mypy 99 hatadan 0’a indi.

### Bağımsız gözden geçirme sonrası düzeltmeler

- Grafiklerde dönem değişimi pencereden önceki son kapanıştan ölçülür (YTD önceki yıl sonundan). 5 yıllık grafik tam aralıkla başlar; 1 TL altı hisseler taramadan düşmez.
- Çeyreklik nakit akışında dönem sonu nakit ve döviz pozisyonu gibi anlık kalemler artık farkla hesaplanmaz; zarar eden şirketler karnede değerlemeden yüksek puan almaz.
- Tarihler izleyicinin saat diliminden bağımsız gösterilir; canlı fiyat güncellemesi kapanış seansını (18:10) kapsar.
- Proxy: parçalı yüklemelerde 1 MB sınırı uygulanır, API dokümantasyonu dışarı kapalı. Caddy HSTS başlığı doğru uygulanır; production migration’ı yapılandırma kontrolünü geçer; yarım kalan geri yükleme hata verir.
- CI action’ları Node 24 sürümlerine yükseltildi.

### Önceki hazırlık (11 Ağustos 2026)

- KAP finansal tablo parser’ı, dönem/sunum birimi metadata’sı ve canlı oran hesaplamaları düzeltildi.
- Screener, scanner ve sembol arama güncel BIST veri sözleşmesine uyarlandı.
- Finansal tablolar, temettü, hedef fiyat, ortaklık, kazanç takvimi ve teknik sinyal ekranlarındaki veri eşlemeleri düzeltildi.
- Makro, piyasa ve temel veri kalite testleri eklendi; upstream hataların boş veri gibi gösterilmesi engellendi.
- Next.js hata durumları ve aynı-origin API proxy’si tamamlandı.
- Repo tek README ve tek CI akışına indirildi; legacy arayüz, tekrar eden belgeler ve kullanılmayan kod kaldırıldı.
- Docker build context’i küçültüldü ve backend image’ı non-root kullanıcıya geçirildi.

## 0.8.0 — 12 Temmuz 2026

- Google News RSS ile hisse bazlı haber toplama eklendi.
- Haberler için AI duygu/etki sınıflandırması ve `news_items` migration’ı eklendi.
- Hisse sayfasına 48 saatlik haber bölümü eklendi.
- Haberler AI analiz snapshot’ına dâhil edildi.

## 0.7.0 — 12 Temmuz 2026

- AI sağlayıcısı Gemini veya Anthropic olarak seçilebilir hâle getirildi.
- Rapor girdisine fiyat, teknik, temel, KAP ve makro veriler eklendi.
- İçerik hash’i, günlük bütçe sınırı ve kanıta dayalı rapor formatı eklendi.

## 0.6.0 — 11 Temmuz 2026

- Cache’li AI hisse raporu ve SSE streaming endpoint’leri eklendi.
- `ai_reports` migration’ı ve gece rapor worker’ı eklendi.
- AI anahtarı olmayan kurulumların diğer özellikleri etkilememesi sağlandı.

## 0.5.1 — 10 Temmuz 2026

- Grafik periyotları, TCMB politika faizi, snapshot, endeks ve canlı oran veri eşlemeleri düzeltildi.
- Frontend API hataları görünür hâle getirildi ve API base URL merkezileştirildi.
- BIST 100 seed, sınırlı cache ve thread pool eklendi.
- Admin backfill parametreleri çalışır hâle getirildi.

## 0.5.0 — 21 Mart 2026

- Admin API key, CORS allowlist ve rate limiting eklendi.
- Worker API prosesinden ayrıldı.
- PostgreSQL atomik upsert, advisory lock, outbox claim ve bildirim idempotency kontrolleri eklendi.
- Production config doğrulaması ve UTC zaman standardı eklendi.

## 0.4.0 — 20 Mart 2026

- Next.js dashboard ve Docker Compose frontend servisi eklendi.
- Uygulama genel BIST analiz platformuna dönüştürüldü.

## 0.3.0 — 20 Mart 2026

- Finansal tabloların veritabanına yazılması ve sekiz finansal oran eklendi.
- Olay sınıflandırması ve ilk tam Alembic şeması eklendi.

## 0.2.0 — 15 Mart 2026

- Çoklu hisse desteği, teknik/temel/makro endpoint’leri ve tarama araçları eklendi.

## 0.1.0 — 14 Mart 2026

- FastAPI, PostgreSQL, KAP/fiyat worker’ı ve bildirim altyapısıyla ilk sürüm oluşturuldu.
