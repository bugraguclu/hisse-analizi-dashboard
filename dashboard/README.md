# Hisse Analizi Dashboard — Web

BIST analiz platformunun Next.js 16 ve React 19 ile geliştirilen web arayüzüdür. Tarayıcı, backend'e varsayılan olarak aynı origin altındaki `/api/*` adreslerinden erişir; Next.js route handler istekleri sunucu tarafında FastAPI'ye iletir. Böylece backend adresi ve Docker servis adı istemci paketine gömülmez.

## Gereksinimler

- Node.js 20+
- Çalışan Hisse Analizi FastAPI servisi

## Yerel geliştirme

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Arayüz `http://localhost:3000`, varsayılan backend ise `http://localhost:8000` adresinde çalışır.

## Ortam değişkenleri

| Değişken | Kullanım | Varsayılan |
|---|---|---|
| `API_URL` | Next.js sunucusunun bağlanacağı dahili FastAPI adresi. Üretimde önerilen seçenektir. | `http://localhost:8000` |
| `NEXT_PUBLIC_API_URL` | İsteğe bağlı doğrudan tarayıcı API adresi. Yalnızca ayrı origin ve doğru CORS yapılandırması gerektiğinde kullanın. | `/api` |

`API_URL` yalnızca sunucu tarafında okunur ve çalışma zamanında değiştirilebilir. Gizli anahtarları `NEXT_PUBLIC_*` değişkenlerine koymayın.

## Kalite kontrolleri

```bash
npm run lint
npm run build
```

Üretim derlemesini yerelde çalıştırmak için:

```bash
npm run build
API_URL=http://localhost:8000 npm run start
```

## Docker

Repo kökünden tüm sistemi başlatın:

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec app alembic upgrade head
docker compose exec app python scripts/seed.py
```

Dashboard `http://localhost:3000` adresinde yayınlanır. Compose yapılandırması dashboard container'ına `API_URL=http://app:8000` verir; bu değer tarayıcıya açılmaz.

## Yayınlama kontrol listesi

- Üretim `API_URL`, veritabanı ve `ADMIN_API_KEY` değerlerini secret/env yönetiminde tanımlayın.
- Migration'ları yeni sürümden önce çalıştırın.
- `/health` ve dashboard üzerinden `/api/health` yanıtlarını doğrulayın.
- `npm run lint`, `npm run build` ve backend testlerini geçmeden yayınlamayın.
- TLS'i ve reverse proxy güvenlik başlıklarını platform katmanında etkinleştirin.
