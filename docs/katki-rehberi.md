# Katkı Rehberi

Katkı kurallarının güncel ve tek kaynağı repo kökündeki [CONTRIBUTING.md](../CONTRIBUTING.md) dosyasıdır.

Hızlı kontrol komutları:

```bash
.venv/bin/ruff check src tests
.venv/bin/pytest -q

cd dashboard
npm run lint -- --max-warnings=0
npm run build
```

Finansal veri değişikliklerinde birincil kaynak karşılaştırması ve eksik/hatalı upstream senaryosu testi pull request’e eklenmelidir.
