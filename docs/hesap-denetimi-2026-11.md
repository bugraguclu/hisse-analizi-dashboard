# Hesap ve veri doğruluğu denetimi — 24 Kasım 2026

Kapsam: platformun kendi hesapladığı her değer (oranlar, son 12 ay, TMS 29 çeyrekleri, teknik
göstergeler, piyasa istatistikleri, sektör ve benzer şirket toplamları, alarmlar) ve bunların
girdisi olan saklanan veri. Denetim üç bağımsız kod incelemesi, yeniden hesaplama ve gerçek
veriyle geçmişe dönük testlerden oluşur. Depolama katmanının sertleştirilmesi (indeksler, saklama
süreleri, iş kaydı) ayrı bir dalda (`gemini-data_enchantement`, M1–M2) yürüdüğü için burada
yalnızca hesap ve veri doğruluğu ele alındı; o dalın dosyalarına dokunulmadı.

## Sonuç

Çekirdek formüller doğru: 15 oranın tanımı, TTM = son dört çeyrek, TMS 29 çeyrek türetmesi
(TÜFE katsayısı ve Haziran mali yıl sonu dahil), Wilder RSI, MACD, Bollinger (popülasyon std),
yavaş Stokastik, Supertrend, haftalık bar türetmesi, YTD bazı, seans saatleri ve kur eşleştirmesi
(ileriye bakma yok). Bulunan hatalar uç durumlardaydı; hepsi düzeltildi ve her biri için eski
kodda başarısız olan bir test yazıldı (11/11).

## Düzeltilen hatalar

| # | Sorun | Etki | Düzeltme |
|---|---|---|---|
| 1 | **F/K üç uçta üç farklı değer.** Grafik başlığı İş Yatırım kartının F/K'sını, fiyat şeridi TradingView `price_earnings_ttm`'yi, oran kartı kendi hesabımızı gösteriyordu. | Yedi şirketin tamamı: THYAO 3,0 / 3,94 / 3,77; GARAN 4,9 / 4,97 / 5,57; SISE 9,6 / 8,0 / 10,75; KCHOL şeritte boş. | Tek kural (`market_service.price_to_earnings`): güncel piyasa değeri ÷ depodaki son TTM ana ortaklık net kârı (`FundamentalsRepository.latest_ttm_earnings`). Zararda boş; depoda kâr yoksa sağlayıcı değeri. Yanıtlara eklemeli `pe_source` ve `meta.notes` notu. PD/DD zaten bu şekilde tekti. |
| 2 | Tek bir TÜFE ayı eksikse (seride boşluk ya da ayın verisi henüz yok) TMS 29 şirketlerinde TTM'in **bütün kalemleri** boş dönüyor, kart yıllık değere düşmüyordu. | Oran kartı tamamen boş; büyüme de kaybolur. | Eksik katsayı eksik dönem gibi ele alınır (`ttm_flows` → `None`), kart son mali yıla düşer. |
| 3 | Önceki yıl özkaynağı negatifse ortalama özkaynak çok küçülüyordu. | 100 kâr / ((500 − 480) ÷ 2) = **%1.000 ROE**. | Açılış bakiyesi ≤ 0 ise kapanış bakiyesi kullanılır (%20). |
| 4 | Ana ortaklık ve toplam rakamları yıllar arasında karışıyordu (her yıl ayrı ayrı yedeğe düşüyordu). | Toplam 120 / ana ortaklık 80 → %50 büyüme (doğrusu %33,33). | Bir çift için tek baz (`_same_basis`); çift kurulamıyorsa değer boş. |
| 5 | Nakit eksikse 0 sayılıyordu. | Net borç ve FD/FAVÖK şişer (örnekte %27). "Eksik veri 0 değildir" kuralına aykırı. | Nakit yoksa net borç ve FD boş; kısa vadeli yatırım satırının olmaması 0 sayılmaya devam eder. |
| 6 | İş Yatırım değerleri KAP birimine yuvarlanırken yarım birimden küçük tutarlar **0** oluyordu. | 400.000 TL × 0,85, milyon TL raporda 0. | Böyle tutarlar tam TL'ye yuvarlanır. |
| 7 | 52 haftalık en yüksek/en düşük değer günün saatine bağlıydı. | Saat 08:00'de ve 14:00'te farklı değer. | Takvim günü sınırı. |
| 8 | Pazartesi açılışı eksik bir haftada haftalık açılış Salı'dan alınıyordu. | Uydurma açılış. | İlk seansın açılışı; eksikse boş. |
| 9 | 2 yıllık / 5 yıllık haftalık grafikte dönem değişimi bazının tarihi, kapanışın değil haftanın Pazartesi damgasıydı. | Etiket ile değer farklı günlere ait. | Depo yolunda tarih, kapanışın kendi seansından alınır (değer aynı). |

## Geçmiş verisiyle testler

**Sabit gerçek veri kopyası:** `tests/fixtures/recorded_history.json` (311 KB), canlı platformdan
kaydedilmiş yanıtlardan üretilir (`scripts/freeze_recorded_fixture.py`). İçinde 7 şirket var:
THYAO, GARAN, ASELS, BIMAS, KCHOL, SISE, EREGL. Her biri için 501 günlük bar (Kasım 2024 – 23
Kasım 2026), sunulan gösterge değerleri, KAP/İşY tabloları, oran kartı ve fiyat şeridi bulunur.
Testler `tests/unit/test_recorded_history_regression.py` dosyasındadır (90 test).

| Kontrol | Sonuç |
|---|---|
| SMA 10–200, EMA 10–50, RSI 14, MACD, Bollinger, Stokastik, Supertrend: kodumuz kayıtlı barlarda yeniden çalıştırıldı; sonuç sunulan değerle ve bu dosyada yazılmış bağımsız referans uygulamayla karşılaştırıldı | 7/7 şirket, 4 ondalıkta aynı. EMA 100/200'de yalnızca tohum farkı var (≤ %0,2; depo daha eski bardan başlıyor). |
| Tek çeyrekler kümülatif tablodan yeniden türetildi (Q1 = YTD, Q4 = Yıllık − 9A, düz fark) | Bütün sunulan çeyrekler aynı. |
| TTM = son dört çeyreğin toplamı; düz raporlayıcılarda YTD + önceki yıl − önceki YTD | Bütün şirketlerde. THYAO 2026/09 hasılat 981.030 + 955.472 − 690.825 = 1.245.677 mn TL. |
| TMS 29 TÜFE katsayısı: dört şirketin 17–19 kaleminden geri çıkarıldı | Her çeyrekte tek bir değer (fark < 1e-6). TÜİK resmî aylık TÜFE'siyle aynı: 2024/06 1,08406 · 2024/09 1,08921 · 2025/06 1,06009 · 2025/09 1,07506. |
| F/K, F/S, marjlar, FD/FAVÖK, net borç/FAVÖK = sunulan girdilerden yeniden hesap | Kuruşu kuruşuna. |
| Bilanço denkliği (varlıklar = kaynaklar = yükümlülük + özkaynak) | Her dönemde fark 0. |
| Fiyat serisi: sıralı, tekrarsız, hafta sonu yok, OHLC tutarlı; 1 aylık pencere 1 yıllık serinin kuyruğu; dönem bazı pencereden önceki son kapanış | Hepsi geçti. |
| USD görünümü: her tarihte bütün hisseler aynı USD/TRY kuruna bölünmüş | Geçti. |

**İkinci kaynakla canlı geçmiş testi:** `tests/integration/test_recorded_history_live.py`. Kayıtlı
3.507 TradingView kapanışı, İş Yatırım'ın resmî düzeltilmemiş kapanışıyla (`HG_KAPANIS`)
karşılaştırıldı ve 3.507'sinin hepsi tek bir bedelsiz katsayısı içinde aynı çıktı. Katsayı yalnızca
iki şirkette değişiyor: BIMAS'ta Mayıs 2026 %100 bedelsizinden önce ×0,5, EREGL'de Kasım 2024
sonundan önce ×0,5. Diğer beş şirkette katsayı ×1.

## Açık konular (düzeltilmedi, bilinçli)

- **Kanıtsız TMS 29 sınıflandırması.** Bir şirketin hiçbir İşY ara dönem sütununda 2OCF/3Z
  kanıtı yoksa sütunlar yıl sonu yeniden ifadesine bakılarak "yeniden ifade edilmiş" sayılır.
  `test_fundamentals_restatement.py` bunu bilerek sabitliyor. Bu kural TMS 29 uygulayan şirketler
  için doğrudur. Ama 2OCF satırı eksik olan USD fonksiyonel bir şirket (THYAO, PGSUS, EREGL tipi)
  olursa ara dönem akımları yanlışlıkla ~0,76 ile çarpılır. Gerçek veride görülmedi; KAP birincil
  kaynak olduğu için etkisi yalnızca boşluk doldurmada olur.
- **Sektör F/K ve PD/DD**, TradingView değerlerinin medyanıdır (zarar edenler hariç). Toplam
  bazlı (Σ PD ÷ Σ kâr) değil ve TradingView'in bedelsiz sonrası hatalarını taşır (EFOR, ALTNY).
  Ekranda "medyan" olarak gösterilmeli ya da toplam bazlı değer eklenmeli.
- **Hisse tarayıcısındaki F/K** hâlâ TradingView'den gelir (`screener_adapter`, dondurulmuş dosya).
  Tarama listesindeki F/K, hisse sayfasındakinden birkaç puan farklı olabilir.
- `AnalysisService.ratios_from_statements` (eski yol) ara dönemi yıllıklaştırmadan kullanır;
  hiçbir yerden çağrılmıyor. Silinmeli.
- `debt_to_equity` toplam yükümlülük ÷ özkaynaktır (finansal borç ÷ özkaynak değil); arayüzde
  "Yükümlülük/Özkaynak" diye etiketlenmeli.

## Nasıl çalıştırılır

```bash
SKIP_NETWORK_TESTS=1 pytest -q tests/unit/test_recorded_history_regression.py tests/unit/test_calculation_fixes.py
pytest -q tests/integration/test_recorded_history_live.py      # ağ gerekir (~10 sn)
python scripts/freeze_recorded_fixture.py                       # demo yeniden kaydedilince, bilinçli olarak
```
