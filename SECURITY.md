# Güvenlik Politikası

Hisse Analizi Dashboard; haricî veri kaynakları, bir web API’si, arka plan worker’ları ve PostgreSQL kullandığı için güvenlik bildirimlerini sorumlu açıklama yaklaşımıyla ele alır.

## Desteklenen sürümler

Güvenlik düzeltmeleri aktif geliştirme dalına uygulanır.

| Sürüm | Destek |
|---|---|
| `master` / en güncel `0.8.x` | Destekleniyor |
| Daha eski sürümler | Yalnızca kritik durumlarda değerlendiriliyor |

## Açık bildirme

Bir güvenlik açığı bulduysanız public GitHub issue açmayın. Depodaki **Security → Advisories → Report a vulnerability** akışını kullanarak özel rapor gönderin.

Rapor şu bilgileri içermelidir:

- Etkilenen endpoint, servis, dosya veya sürüm.
- Sorunun etkisi ve gerekli ön koşullar.
- Güvenli biçimde hazırlanmış yeniden üretme adımları veya kavram kanıtı.
- Varsa önerilen düzeltme ya da geçici önlem.
- Açıklama/koordinasyon için tercih ettiğiniz zamanlama.

Secret, gerçek kullanıcı verisi, veritabanı dökümü veya üçüncü taraf erişim anahtarını rapora eklemeyin.

## Kapsam

Özellikle aşağıdaki bulgular güvenlik kapsamındadır:

- Kimlik doğrulama veya `X-Admin-Key` atlatma.
- Yetkisiz veri yazma/silme, SQL injection veya command injection.
- SSRF, path traversal, hassas bilgi sızıntısı ya da secret ifşası.
- Rate limit’i aşarak kalıcı hizmet kesintisi oluşturma.
- E-posta başlığı enjeksiyonu veya bildirim sisteminin kötüye kullanımı.
- Bağımlılık zinciri üzerinden uygulanabilir kritik açık.

Haricî veri sağlayıcısının geçici kesintisi, beklenen piyasa verisi gecikmesi, finansal yorum anlaşmazlığı ve yapılandırılmamış AI sağlayıcısının `503` dönmesi tek başına güvenlik açığı değildir; normal bug report olarak iletilebilir.

## Operasyonel güvenlik önerileri

- Production’da `APP_ENV=production`, güçlü `ADMIN_API_KEY` ve özel PostgreSQL kimlik bilgileri kullanın.
- Secret’ları `.env` dosyasıyla image içine kopyalamayın; deployment secret yöneticisinden enjekte edin.
- `CORS_ORIGINS` değerini yalnızca güvenilen HTTPS origin’leriyle sınırlandırın.
- Veritabanını internete doğrudan açmayın; yedekleri şifreleyin ve geri yükleme testleri yapın.
- TLS, güvenlik başlıkları, ağ erişim kontrolleri, log redaction ve uptime/error izlemeyi platform katmanında etkinleştirin.
- SMTP gönderimini doğrulamadan `ENABLE_REAL_EMAIL=true` yapmayın.
