# Değişiklik Günlüğü

## 1.1.0 — 23 Eylül 2026 (data-infra)

Veri altyapısı baştan kuruldu: her veri kümesi kanonik biçimde, köken bilgisiyle PostgreSQL'de saklanır ve
depo öncelikli servis edilir. Mevcut API alanları korunmuş, yalnızca `meta` bloğu ve yeni alanlar eklenmiştir.
Mimari sözleşme ve ölçülen kaynak gerçekleri [docs/data-platform.md](./docs/data-platform.md) dosyasındadır.

### Şema (migration 020)

- Yeni tablolar: `market_indices`, `index_memberships`, `quotes`, `price_bars` (eski `price_data` yerine; kaynak anahtarda değil, sembol başına tek seri), `financial_facts`, `dividends`, `capital_increases`, `shareholders`, `analyst_targets`, `expected_disclosures`, `macro_series`, `fx_bulletins`, `data_snapshots`, `ingestion_runs`, `data_quality_checks`.
- `financial_statements` ve `financial_ratios` v2 biçimine geçti (kaynak, dönem `YYYY/MM`, tablo türü, sıralı `items_json`, yeniden ifade katsayısı; oranlarda `basis: ttm|annual`, `inputs_json` denetim izi). `companies` kimlik/katman kolonları kazandı (`isin`, `sector`, `industry`, `market_segment`, `kap_member_oid`, `free_float_pct`, `tracking_tier`, `listing_status`, `paid_in_capital`, …).
- İş kaydı: her worker işi `ingestion_runs` satırı yazar; `polling_state` satırları (`price`, `financials`) yeni işler tarafından güncellenmeye devam eder.

### Veri kaynakları ve doğruluk (ölçülenler)

- **Evren:** Borsa İstanbul resmî bileşen dosyası + TradingView tarayıcı + KAP şirket sayfaları; 629 aktif hisse (100 çekirdek/BIST 100 + 529 evren), 86 endeks, 5.749 üyelik. XU100 üyeliği resmî dosya ile TradingView arasında 100/100, tüm endekslerde 592 bileşende sıfır fark. Halka açıklık oranı KAP/MKK'dan alınır (İş Yatırım ile ≤0,03 puan fark; TradingView 5,6 puana kadar sapıyordu). KOZAA/KOZAL borsa kodu değişimi (TRMET/TRALT) tespit edilip pasife alındı.
- **Kotasyon ve barlar:** TradingView tarayıcı tek istekte tüm evreni verir (15 dk gecikmeli, `delay_seconds: 900`); günlük barlar bölünme düzeltmeli TradingView serisidir. İş Yatırım `HG_KAPANIS` ile 566/566, Yahoo ile 576/576 birebir; tüm evrende 4.923 seansta sıfır uyumsuzluk. Eski `price_data` tablosundaki 6.421 barın 293'ü hatalıydı (seans ortasında yazılıp kapanış sayılan 10–14 Temmuz günleri, +21 eksik seans); yeniden yüklendi. Depo 634 sembol için 374.604 günlük bar taşır (çekirdek 5 yıl, evren 2 yıl). `HGDG_*` alanlarının temettü düzeltmeli olduğu, TradingView hacminin lot (Yahoo ile birebir), İş Yatırım `HG_HACIM`'in TL olduğu doğrulandı; TL ciro ve AOF İş Yatırım'dan alınır.
- **Finansal tablolar:** KAP finansal özet (ilk açıklanan, resmî) birincil; İş Yatırım MaliTablo çeyrekleri yalnızca KAP ile son iki ortak dönemde eşleştiğinde kullanılır ve IAS 29 yeniden ifade katsayısıyla (2025/12 0,8492, 2024/12 0,7640, 2023/12 0,6926) KAP bazına çevrilir. 24 şirkette toplam varlık/özkaynak/hasılat/net kâr KAP ile %0,000 fark. Banka/sigortacılarda İş Yatırım kapsam farkı nedeniyle yalnızca KAP dönemleri kullanılır. Pay adedi ödenmiş sermayeden alınır (TradingView KCHOL için 1,86 mr yerine doğrusu 2,54 mr).
- **Makro:** TCMB faiz/koridor sayfaları, TÜFE/ÜFE tabloları ve günlük kur XML'i (24 para birimi, 2 yıl arşiv) tam geçmişle depoda; borsapy ile 0 uyumsuzluk, USD/TRY bülteni ile TradingView kapanışı arasındaki fark ortalama −0,05 TL. EVDS3 isteğe bağlı (`MACRO_EVDS_API_KEY`).
- **Referans:** temettü, sermaye artırımı, ortaklık yapısı (KAP/MKK ≥%5), hedef fiyat konsensüsü (hedeffiyat.com.tr), KAP beklenen bildirimler. hedeffiyat "kapsam yok" (0,00 ₺) durumu artık hedef olarak saklanmaz; İş Yatırım tarih damgalarının UTC gece yarısı olduğu tespit edilip eski temettü tarihlerindeki 1 günlük kayma düzeltildi.

### API

- Tüm veri yanıtlarında eklemeli `meta` bloğu; liste uçlarında `X-Data-*` başlıkları (CORS ile dışa açık).
- `GET /companies` çekirdek katmanı döner; `?tier=universe|all`, `?include_inactive=true` eklendi. `CompanyOut`, `PriceOut`, `FinancialStatementOut`, `FinancialRatioOut` yeni alanlar kazandı (hiçbir alan kaldırılmadı).
- Yeni: `GET /data/status`, `GET /data/quality`, `GET /data/quality/history`, `POST /admin/data/quality/run`, `POST /admin/data/refresh`, `POST /admin/financials/refresh`. `/macro/*` uçları depodan servis edilir (`/macro/calendar` değişmedi).
- `/recommendations` yanıtına `date` ve `source_code` eklendi.

### Worker

- Yeni döngüler: `reference` (evren senkronu 07:30 + çekirdek şirket referans yenilemesi), `market` (seans içinde 60 sn kotasyon, 18:40 günlük bar, 20:00 İş Yatırım mutabakatı, arka plan geçmiş yükleme), `fundamentals` (çekirdek 72 saat / evren 14 gün, oranlar 19:00 sonrası), `macro` (10:00 ve 14:30 faiz, TÜİK yayın penceresi, 15:35 kur), `quality` (19:30 günlük kontrol + bakım). KAP trafiği tek kapıdan (`kap_get`/`kap_post`, ≥3 sn aralık, WAF sonrası 7 dk bekleme) geçer.
- Eski `polling_worker` yalnızca KAP'ı tarar; `price` ve `financials` yönetim "run once" uçları için kalır. Haber taraması çekirdek şirketlerle sınırlandı.

### Geliştirme

- `docker-compose.dev.yml` overlay'i kaynakları konteynerlere bind-mount eder (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`), imaj yeniden derlemeden kod değişikliği çalışır.
- `tests/conftest.py` `pg_session` fixture'ı (gerçek PostgreSQL, süreç başına ayrı şema); canlı sağlayıcı testleri `tests/integration/`.

## 1.0.0 — 22 Eylül 2026

İlk üretim sürümü: veri doğruluğu, güvenlik, performans ve işletim tarafı baştan sona gözden geçirildi.

### Kaldırılanlar

- AI analiz raporu kaldırıldı: hisse sayfasındaki kart, `/ai/status` ve `/ai/report/*` uç noktaları (SSE akışı dahil), gece rapor worker’ı ve `ai_reports` tablosu (migration 009). `RATE_LIMIT_AI`, `AI_REPORT_MODEL`, `AI_REPORT_MAX_TOKENS` ve `AI_NIGHTLY_BATCH_*` ayarları artık kullanılmıyor. Haber duygu sınıflandırması ve günlük AI bütçesi (`ai_usage`) aynen çalışır; Anthropic seçiliyken sınıflandırma `AI_CLASSIFIER_MODEL` ile yapılır.

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
- Haber sınıflandırması: kesik (max-token) yanıtlar kullanılmaz, sağlayıcı kotası dolunca 30 dk duraklar ve son 48 saatin etiketsiz haberleri sonradan tamamlanır.

### Arayüz

- Ana sayfa bileşenlere ayrıldı; sistem sayaçları yerine piyasa genişliği ve günün en çok yükselen/düşen hisseleri gösteriliyor.
- Hisse sayfaları (Genel/Teknik/Temel/Kombine) ortak başlık ve sekmelerle birleşti; sayfa anında açılır, bölümler kendi iskeletleriyle yüklenir. Başlık günlük değişimi gösterir.
- Finansal tablolar dönem, birim ve kümülatif/çeyreklik etiketiyle; analiz karnesi “Nasıl hesaplandı?” açıklamasıyla.
- Olaylar sayfası sunucu tarafı filtre ve sayfalama; tarama ve makro sayfaları yenilendi; filtreler URL’de saklanır.
- Mobil çekmece menü, erişilebilir arama, çerezle kalıcı dil (TR/EN/FR), karanlık/açık tema, yükseliş/düşüş renkleri tek yerden (`--up`/`--down`).
- Ekonomik takvimde önem ve ülke filtresi; Türkçe kısaltmalarda bin basamağı “B” yerine “bin” (milyar ile karışmasın diye).

### Altyapı

- `docker-compose.yml` migration’ları otomatik çalıştırır (`migrate` servisi); `docker-compose.prod.yml` Caddy ile otomatik HTTPS, yalnızca 80/443 dışarı açık, kaynak ve log sınırları.
- `scripts/backup.sh` / `scripts/restore.sh`; `alembic` artık `DATABASE_URL_SYNC` kullanır (yerel geliştirmede de çalışır). Yeni migration’lar: 005 (sorgu indeksleri), 006 (bildirimler şirket başına), 007 (KAP aralığı), 008 (AI harcama kaydı), 009 (`ai_reports` kaldırıldı).
- CI: mypy, TypeScript kontrolü, migration gidiş-dönüş testi ve iki Docker imajının derlenmesi eklendi.
- Testler 88’den 589’a çıktı; mypy 99 hatadan 0’a indi.

### Bağımsız gözden geçirme sonrası düzeltmeler

- AI: her ücretli çağrı (kesik yanıtlar dahil) `ai_usage` tablosuna yazılır ve süreçler arasında paylaşılan tek günlük bütçeye sayılır.
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
