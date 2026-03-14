# 🤝 Katkı Rehberi — Hisse Takibi

## Geliştirme Ortamı

### Gereksinimler
- **Docker Desktop** (Windows, WSL2 etkin)
- **Git** 
- **VS Code** (önerilen)

### İlk Kurulum
```bash
# 1. Repo'yu klonla
git clone https://github.com/bugraguclu/hisse-analizi-dashboard.git
cd hisse-analizi-dashboard

# 2. .env dosyasını oluştur
cp .env.example .env
# .env'deki localhost → db olarak değiştir (Docker için)

# 3. Docker'ı başlat
docker-compose up -d --build

# 4. Şirket verilerini yükle
docker-compose exec app python scripts/seed.py

# 5. Test et
# Tarayıcıda aç: http://localhost:8000/docs
```

---

## Git Çalışma Kuralları

### Branch İsimlendirme
```
feature/dashboard       ← Yeni özellik
fix/kap-adapter-crash   ← Hata düzeltme
docs/api-rehberi        ← Doküman güncellemesi
```

### Commit Mesajları
```
feat: BIST 30 şirketleri eklendi
fix: KAP adapter timeout hatası düzeltildi
docs: API rehberi güncellendi
refactor: polling worker temizlendi
```

Ön ekler:
| Önek | Kullanım |
|------|----------|
| `feat:` | Yeni özellik |
| `fix:` | Hata düzeltme |
| `docs:` | Doküman değişikliği |
| `refactor:` | Kod düzenlemesi (davranış değişmez) |
| `test:` | Test ekleme/düzeltme |

### Günlük İş Akışı
```bash
# 1. Güncel kodu çek
git pull origin master

# 2. Yeni branch oluştur
git checkout -b feature/benim-ozelligim

# 3. Kodla...

# 4. Değişiklikleri kaydet
git add -A
git commit -m "feat: yeni özellik açıklaması"

# 5. GitHub'a yükle
git push origin feature/benim-ozelligim

# 6. GitHub'da Pull Request aç
```

---

## Kod Yazma Kuralları

- **Dil:** Kod İngilizce, açıklamalar/yorumlar Türkçe
- **Açıklama:** Her fonksiyon ve karmaşık satır açıklanmalı
- **Hata yönetimi:** try/except kullan, hataları logla
- **Loglama:** `structlog` kullan, `print()` değil
- Detaylar için: `.agent/workflows/coding-style.md`

---

## Sık Kullanılan Komutlar

```bash
# Docker
docker-compose up -d          # Başlat
docker-compose down            # Durdur
docker-compose logs -f app     # Logları izle
docker-compose exec app bash   # Container'a gir

# Git
git status                     # Ne değişti?
git log --oneline -5           # Son 5 commit
git diff                       # Değişiklikleri gör

# Veritabanı
docker-compose exec app python scripts/seed.py  # Şirket yükle
```

---

## Sorun Çözme

| Sorun | Çözüm |
|-------|-------|
| `.env not found` | `cp .env.example .env` çalıştır |
| `port 5432 in use` | Eski PostgreSQL'i kapat: `docker-compose down` |
| `connection refused` | Docker çalışıyor mu? `docker ps` ile kontrol et |
| `module not found` | `docker-compose up -d --build` ile yeniden build et |
