# Katkı Rehberi

Hisse Analizi Dashboard’a katkıda bulunduğunuz için teşekkürler. Bu belge, değişikliklerin güvenli, incelenebilir ve tekrarlanabilir biçimde hazırlanması için ortak çalışma kurallarını tanımlar.

## Başlamadan önce

- Küçük hata düzeltmeleri için doğrudan pull request açabilirsiniz.
- Büyük özellikler, veri kaynağı değişiklikleri veya API sözleşmesi kıran işler için önce issue açarak yaklaşımı netleştirin.
- Güvenlik açıklarını public issue olarak bildirmeyin; [SECURITY.md](./SECURITY.md) sürecini kullanın.
- Finansal veriyle ilgili değişikliklerde birincil kaynağı ve doğrulama örneğini pull request açıklamasına ekleyin.

## Geliştirme ortamı

### Docker ile

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec app alembic upgrade head
docker compose exec app python scripts/seed.py
```

### Yerel backend

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev,email]"
cp .env.example .env
alembic upgrade head
uvicorn src.api.app:app --reload
```

### Yerel frontend

```bash
cd dashboard
cp .env.example .env.local
npm ci
npm run dev
```

## Branch ve commit düzeni

Branch adlarında kısa ve açıklayıcı bir ön ek kullanın:

```text
feature/analist-karsilastirma
fix/kap-tarih-ayristirma
docs/api-rehberi
```

Commit mesajlarında Conventional Commits yaklaşımı tercih edilir:

```text
feat: add analyst comparison table
fix: normalize KAP presentation units
docs: refresh deployment guide
test: cover quarterly income statement parsing
```

Sık kullanılan türler: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`.

## Kod kuralları

- Python 3.11+ ve mevcut async mimariyle uyumlu kod yazın.
- API’ye giren ticker değerlerini ortak doğrulama katmanından geçirin.
- Haricî sağlayıcı çağrılarını `src/adapters/` altında tutun; router içinde scraping/veri dönüştürme yapmayın.
- Eksik finansal veriyi `0` ile doldurmayın. `null`, hata durumu veya açıklayıcı metadata kullanın.
- Tarih, para birimi, sunum birimi ve kaynak bilgisini veri sözleşmesinde kaybetmeyin.
- DB yazımlarında mevcut atomik upsert/idempotency kalıplarını koruyun.
- Gizli anahtar, gerçek `.env`, erişim token’ı veya müşteri verisi commit etmeyin.
- Frontend’de erişilebilir etiketler, responsive düzen ve loading/error/empty durumlarını birlikte ele alın.

## Test ve doğrulama

Pull request göndermeden önce ilgili kontrolleri çalıştırın:

```bash
# Backend
.venv/bin/ruff check src tests
.venv/bin/pytest -q

# Frontend
cd dashboard
npm run lint -- --max-warnings=0
npm run build

# Compose
cd ..
docker compose config --quiet
```

Veri adaptörü değişikliklerinde ayrıca:

1. Başarılı ve eksik/hatalı upstream yanıtlarını test edin.
2. En az bir gerçek BIST sembolünü resmî/birincil kaynakla karşılaştırın.
3. Cache anahtarı ve TTL etkisini kontrol edin.
4. Kullanıcı arayüzünde yanlış `0`, yanlış tarih veya eski veri görünmediğini doğrulayın.

Canlı servis kullanan testleri `integration` marker’ı ile işaretleyin ve mümkün olduğunda deterministik fixture ekleyin.

## Pull request kontrol listesi

- [ ] Değişiklik tek bir amaca odaklanıyor.
- [ ] Yeni davranış için test eklendi veya neden gerekmediği açıklandı.
- [ ] Backend lint/test ve frontend lint/build başarılı.
- [ ] API veya ortam değişkeni değiştiyse README/dokümantasyon güncellendi.
- [ ] Veri kaynağı değiştiyse kaynak ve doğrulama kanıtı eklendi.
- [ ] Migration geri/ileri çalışma etkisi değerlendirildi.
- [ ] Secret, kişisel veri veya lisanssız büyük içerik eklenmedi.

## İnceleme beklentisi

İnceleyici; veri doğruluğu, geriye dönük uyumluluk, güvenlik, hata davranışı ve yayın riski açısından geri bildirim verebilir. Yorumları küçük, bağımsız commit’lerle çözmek incelemeyi hızlandırır.
