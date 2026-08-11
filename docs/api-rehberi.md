# API Kullanım Rehberi

Hisse Analizi Dashboard API’si FastAPI ile geliştirilmiştir. Bu belge `v0.8.0` için endpoint gruplarını ve sık kullanılan örnekleri açıklar; kesin ve makine tarafından okunabilir sözleşme çalışan servisteki OpenAPI çıktısıdır.

## Başlangıç

```bash
cp .env.example .env
docker compose up --build -d db app worker
docker compose exec app alembic upgrade head
docker compose exec app python scripts/seed.py
```

| Kaynak | Adres |
|---|---|
| API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| ReDoc | http://localhost:8000/redoc |
| OpenAPI JSON | http://localhost:8000/openapi.json |

## Genel davranış

- Ticker değerleri büyük harfe çevrilir ve `^[A-Z0-9]{1,10}$` sözleşmesiyle doğrulanır.
- Canlı upstream veri alınamazsa ilgili adaptör endpoint’i açıklayıcı `502` döndürebilir.
- DB’ye bağlı endpoint’ler PostgreSQL erişilemiyorsa başarılı/boş yanıt taklidi yapmaz.
- Rate limit aşıldığında `429` döner. Varsayılan genel limit `60/minute`; admin ve pahalı endpoint’ler ayrı limit kullanabilir.
- Tüm zamanlar API’de ISO 8601 biçimindedir. UI, KAP’ın yerel tarih biçimlerini ayrıca normalize eder.

## Kimlik doğrulama

`/admin/*` endpoint’leri staging/production ortamında `X-Admin-Key` ister:

```bash
curl \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  http://localhost:8000/admin/stats
```

`ADMIN_API_KEY` development modunda boşsa admin auth geliştirme kolaylığı için atlanır. Bu davranış production’da kullanılamaz; uygulama eksik anahtarda fail-fast olur.

## Sistem, şirket ve arşiv

| Yöntem | Endpoint | Açıklama |
|---|---|---|
| `GET` | `/health` | Uygulama sürümü ve ortamı |
| `GET` | `/stats` | DB olay/fiyat/finansal/bildirim sayaçları |
| `GET` | `/companies` | DB’deki şirketler |
| `GET` | `/companies/{ticker}` | Tek şirket |
| `GET` | `/sources` | Worker veri kaynakları |
| `GET` | `/events` | Filtrelenebilir olay listesi |
| `GET` | `/events/latest` | Son olaylar |
| `GET` | `/events/{event_id}` | Olay detayı |
| `GET` | `/prices?ticker=THYAO` | DB fiyat geçmişi |
| `GET` | `/prices/latest?ticker=THYAO` | Son DB fiyat kaydı |
| `GET` | `/financials?ticker=THYAO` | DB finansal tabloları |
| `GET` | `/financials/ratios?ticker=THYAO` | Hesaplanmış DB oranları |
| `GET` | `/notifications` | Bildirim kayıtları |
| `GET` | `/outbox` | Outbox kayıtları |
| `GET` | `/polling-state` | Veri kaynağı polling durumları |

Olay filtre örneği:

```bash
curl "http://localhost:8000/events?ticker=THYAO&source_code=kap&limit=25&offset=0"
```

## Teknik analiz

Tüm endpoint’ler `GET /technical/{ticker}/...` altındadır.

| Endpoint | Parametre | İçerik |
|---|---|---|
| `/rsi` | `period=14` (`2–100`) | RSI değeri |
| `/macd` | — | MACD, signal ve histogram |
| `/bollinger` | `period=20` (`2–100`) | Alt/orta/üst bant |
| `/sma` | `period=20` (`2–200`) | Basit hareketli ortalama |
| `/ema` | `period=20` (`2–200`) | Üssel hareketli ortalama |
| `/supertrend` | — | SuperTrend durumu |
| `/stochastic` | — | Stochastic oscillator |
| `/signals` | — | Tek zaman dilimi teknik öneri özeti |
| `/signals/all-timeframes` | — | Tüm desteklenen zaman dilimleri |
| `/moving-averages` | — | Hareketli ortalama tablosu |
| `/pivots` | — | Pivot seviyeleri |

```bash
curl "http://localhost:8000/technical/THYAO/rsi?period=14"
curl http://localhost:8000/technical/THYAO/signals/all-timeframes
```

## Temel analiz

| Endpoint | Açıklama |
|---|---|
| `GET /fundamentals/{ticker}/info` | Şirket profili |
| `GET /fundamentals/{ticker}/fast-info` | Canlı fiyatlama ve özet metrikler |
| `GET /fundamentals/{ticker}/balance-sheet?quarterly=false` | Resmî KAP bilançosu |
| `GET /fundamentals/{ticker}/income-statement?quarterly=false` | Resmî KAP gelir tablosu |
| `GET /fundamentals/{ticker}/cashflow?quarterly=false` | Nakit akış tablosu |
| `GET /fundamentals/{ticker}/dividends` | Temettü geçmişi |
| `GET /fundamentals/{ticker}/holders` | Ortaklık yapısı |
| `GET /fundamentals/{ticker}/recommendations` | Analist tavsiye özeti |
| `GET /fundamentals/{ticker}/price-targets` | Hedef fiyat konsensüsü |
| `GET /fundamentals/{ticker}/earnings-dates` | Beklenen finansal rapor tarihleri |
| `GET /fundamentals/{ticker}/live-ratios` | Canlı/hesaplanmış temel oranlar |
| `GET /fundamentals/{ticker}/live-news` | Sağlayıcıdan canlı hisse haberleri |

`quarterly=true` ara dönem tablosu ister. Finansal tablo yanıtları kaynak, kaynak URL’si, dönem, sunum birimi ve `as_of` metadata’sı içerebilir.

## Makro ekonomi

| Endpoint | Açıklama |
|---|---|
| `GET /macro/tcmb` | TCMB faiz tablosu |
| `GET /macro/policy-rate` | En güncel politika faizi ve karar tarihi |
| `GET /macro/inflation` | En güncel aylık/yıllık enflasyon |
| `GET /macro/fx/{currency}` | Döviz bilgisi ve geçmişi (`USD`, `EUR`, `GBP`...) |
| `GET /macro/calendar` | Ekonomik takvim |

```bash
curl http://localhost:8000/macro/policy-rate
curl http://localhost:8000/macro/fx/USD
```

## Piyasa, tarama ve arama

| Yöntem | Endpoint | Açıklama |
|---|---|---|
| `GET` | `/market/screener` | Varsayılan tarama |
| `POST` | `/market/screener` | Özel filtrelerle tarama |
| `GET` | `/market/screener/templates` | Hazır filtre şablonları |
| `GET` | `/market/scanner?condition=rsi_oversold` | Teknik sinyal taraması |
| `GET` | `/market/indices` | Ana BIST endeksleri ve canlı kotasyonlar |
| `GET` | `/market/index/{symbol}?period=1ay` | Endeks fiyat serisi |
| `GET` | `/market/index/{symbol}/info` | Endeks bilgisi |
| `GET` | `/market/search?q=THYAO` | İşlem gören BIST payı arama |
| `GET` | `/market/companies/all` | Canlı BIST şirket evreni |
| `GET` | `/market/ticker/{ticker}/history?period=1ay` | Canlı hisse fiyat geçmişi |
| `GET` | `/market/snapshot?symbols=THYAO,GARAN` | Çoklu canlı snapshot |
| `GET` | `/market/tweets/{ticker}` | Opsiyonel sosyal medya sağlayıcısı |

Özel screener filtresi gövdesi sağlayıcının desteklenen filtre sözleşmesine göre normalize edilir. Hazır sözleşmeleri önce `/market/screener/templates` üzerinden alın.

```bash
curl -X POST http://localhost:8000/market/screener \
  -H "Content-Type: application/json" \
  -d '{"pe_max": 10, "roe_min": 15}'
```

Sosyal medya endpoint’i ek provider/auth olmadan hata dönebilir; yayın arayüzünde bu alan kullanılmaz.

## Haber ve AI

| Yöntem | Endpoint | Açıklama |
|---|---|---|
| `GET` | `/news/{ticker}?hours=48` | DB’deki hisse haberleri ve varsa AI duygu/etki etiketleri |
| `GET` | `/ai/status` | Aktif sağlayıcı, model, yapılandırma ve bütçe durumu |
| `GET` | `/ai/report/{ticker}` | Cache’li rapor; yoksa üretir |
| `GET` | `/ai/report/{ticker}/stream` | Server-Sent Events ile rapor akışı |
| `POST` | `/ai/report/{ticker}/regenerate` | Admin anahtarıyla zorla yenileme |

SSE örneği:

```bash
curl -N http://localhost:8000/ai/report/THYAO/stream
```

AI sağlayıcısı yapılandırılmamışsa `503`, günlük bütçe aşılmışsa `429` döner. Haber endpoint’i şirketin DB’de seed edilmiş olmasını gerektirir.

## Yönetim endpoint’leri

Tüm yollar `/admin` prefix’i altındadır ve `X-Admin-Key` gerektirir.

| Yöntem | Endpoint | Gövde/işlev |
|---|---|---|
| `POST` | `/admin/poll/run-once` | `{"source_code": "kap"}` veya `null` ile tek sefer poll |
| `POST` | `/admin/backfill` | `{"days": 30, "source_code": "kap"}` |
| `POST` | `/admin/notification-rules` | Ticker, e-posta, minimum severity ve kaynak filtreleri |
| `POST` | `/admin/notifications/test-send` | Notification worker’ı tek sefer tetikler |
| `GET` | `/admin/stats` | `/stats` ile aynı sayaçlar |

```bash
curl -X POST http://localhost:8000/admin/backfill \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_ADMIN_KEY" \
  -d '{"days": 7, "source_code": "kap"}'
```

## Hata kodları

| Kod | Anlam |
|---|---|
| `200` | Başarılı |
| `202` | Arka plan işi kabul edildi |
| `400` | Geçersiz ticker veya istek |
| `403` | Eksik/yanlış admin anahtarı |
| `404` | Şirket/kayıt bulunamadı |
| `422` | Şema/parametre doğrulama hatası |
| `429` | Rate limit veya AI günlük bütçe sınırı |
| `502` | Haricî veri/LLM sağlayıcısı başarısız |
| `503` | İsteğe bağlı servis/AI sağlayıcısı yapılandırılmamış |

Hata yanıtlarında FastAPI’nin `detail` alanı kullanılır. İstemciler boş liste varsaymak yerine HTTP durumunu ve `detail` mesajını işlemelidir.
