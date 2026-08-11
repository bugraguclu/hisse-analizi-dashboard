# Değişiklik Günlüğü

## Unreleased — 11 Ağustos 2026

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
