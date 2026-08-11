## Amaç

<!-- Bu değişiklik hangi sorunu çözüyor? -->

## Değişiklikler

- <!-- Önemli değişiklikleri maddeler hâlinde yazın. -->

## Doğrulama

<!-- Çalıştırılan komutları ve sonuçları yazın. Veri değişikliğinde birincil kaynak karşılaştırmasını ekleyin. -->

```text
ruff check src tests:
pytest -q:
npm run lint -- --max-warnings=0:
npm run build:
docker compose config --quiet:
```

## Ekran görüntüsü

<!-- Kullanıcı arayüzü değiştiyse önce/sonra görüntüsü ekleyin. -->

## Kontrol listesi

- [ ] Değişiklik tek bir amaca odaklanıyor.
- [ ] Test eklendi/güncellendi veya neden gerekmediği açıklandı.
- [ ] API/ortam değişikliği dokümante edildi.
- [ ] Finansal veri değişikliği birincil kaynakla doğrulandı.
- [ ] Loading, error ve empty durumları kontrol edildi.
- [ ] Secret, kişisel veri veya lisanssız büyük içerik eklenmedi.
- [ ] Geriye dönük uyumluluk ve migration etkisi değerlendirildi.
