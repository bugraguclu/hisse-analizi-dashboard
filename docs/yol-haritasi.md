# 🗺️ Proje Yol Haritası — Hisse Takibi

## Proje Durumu: Faz 2.5 tamamlandı ✅

---

## ✅ Tamamlananlar

### Faz 0 — Altyapı (15 Mart 2026)
- [x] Git + GitHub repo kurulumu
- [x] Docker düzeltmeleri (Dockerfile, docker-compose)
- [x] Alembic migration klasörü
- **Commit:** `2f0ae85`

### Faz 1 — Mimariyi Anla (15 Mart 2026)
- [x] Tüm kaynak dosyaların analizi
- [x] Mimari rehber dokümanı

### Faz 2 — Multi-Stock / BIST 30 (15 Mart 2026)
- [x] 30 BIST şirketi seed'e eklendi
- [x] KAP ve fiyat adapter'ları dinamik hale getirildi
- [x] Polling worker tüm şirketler için çalışır hale geldi
- [x] API'ye ticker filtresi eklendi
- **Commit:** `95a97a9`

### Faz 2.5 — borsapy Tam Entegrasyon (15 Mart 2026)
- [x] 11 yeni veritabanı modeli (finansal, makro, teknik)
- [x] 9 yeni adapter sınıfı
- [x] 25+ yeni API endpoint
- [x] Swagger dokümantasyonu otomatik
- **Commit:** `aa9a0bc`

---

## 🔜 Sıradaki

### Faz 3 — Veritabanı Migration'ları
- [ ] Alembic migration oluştur (yeni tablolar için)
- [ ] Migration çalıştır
- [ ] Veri kaydetme servislerini yaz

### Faz 4 — Next.js Dashboard
- [ ] Next.js projesi oluştur
- [ ] Ana sayfa: Piyasa özeti (endeksler, döviz)
- [ ] Hisse listesi sayfası (30 hisse kartı)
- [ ] Hisse detay sayfası (fiyat grafiği, bilanço, haberler)
- [ ] Teknik analiz sayfası (RSI, MACD grafikleri)
- [ ] Screener sayfası (filtreleme)

### Faz 5 — AI/NLP Haber Sınıflandırma
- [ ] Claude API entegrasyonu
- [ ] Haberleri otomatik sınıflandır (pozitif/negatif/nötr)
- [ ] Severity tespiti

### Faz 6 — Tez Takibi Motoru
- [ ] Yatırım tezi oluşturma
- [ ] Tez → tetikleyici eşleştirme
- [ ] Otomatik tez değerlendirme

---

## 👥 Görev Dağılımı

| Görev | Kişi | Branch |
|-------|------|--------|
| Dashboard (Frontend) | Ataberk | `feature/dashboard` |
| AI/NLP Entegrasyonu | Buğra | `feature/ai-nlp` |
| Backend geliştirme | Beraber | `feature/multi-stock` |

---

## 📅 Haftalık Ritüel

1. **Pazartesi:** Hedef belirleme (GitHub Issues)
2. **Hafta içi:** Kodlama + öğrenme
3. **Cuma:** Sync call (Buğra ile) + PR review
4. **Hafta sonu:** Opsiyonel çalışma + doküman güncelleme
