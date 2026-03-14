cd ~/hisse-analizi-dashboard
nano CONTEXT.md
```

## Adım 2 — Şu içeriği yapıştır (Ctrl+Shift+V)
```
# Hisse Takibi — Oturum Özeti ve Sonraki Adımlar
Tarih: 14 Mart 2026
Katılımcılar: Ataberk + Bugra

## Proje
- Repo: github.com/bugraguclu/hisse-analizi-dashboard
- Stack: Python/FastAPI, PostgreSQL, Docker
- Odak hisse: AEFES

## Kurulum Durumu
- WSL2 + Ubuntu kuruldu (kullanici: bugra)
- Docker Desktop henuz calısmiyor (virtualization hatasi)
- Git clone yapildi

## Sonraki Adim
- Docker Desktop sorununu coz
- docker-compose up -d ile containerlari baslat
- http://localhost:8000/health kontrol et

## Notlar
- .env icinde DATABASE_URL localhost -> db degistirilmeli
- alembic.ini icinde de ayni degisiklik
- psycopg2-binary container icine kurulmali
