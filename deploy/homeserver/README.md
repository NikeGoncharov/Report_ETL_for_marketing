# Домашний деплой RePort (Docker + Cloudflare Tunnel + Caddy)

Перенос RePort с арендованной ВМ Yandex Cloud на self-hosted домашний сервер.
Публичный домен `report-analytics.ru` сохраняется; наружу — через **Cloudflare Tunnel**
(без белого IP и проброса портов), TLS терминируется на краю Cloudflare, а внутри
маршрутизирует **Caddy**. Отличие от прод-ВМ: там был nginx + certbot + systemd,
здесь — контейнеры за туннелем, без единого открытого порта наружу.

**Полный пошаговый runbook (порядок фаз, перенос данных, безопасное переключение, откат):**
`C:\git\homeserver\report-migration-runbook.md`

## Артефакты
- `../../backend/Dockerfile`, `../../backend/docker-entrypoint.sh` — образ backend (FastAPI; `alembic upgrade head` на старте).
- `../../frontend/Dockerfile` — образ frontend (Next.js standalone).
- `../../compose.yaml` — backend + frontend + cloudflared (сеть `web`, портов не публикуют).
- `../../.env.example` — шаблон секретов (скопировать в `.env`, заполнить).
- `report.Caddyfile` — блок сайта для общего Caddy сервера.

## Быстрый старт на сервере (кратко; детали и порядок — в runbook)
```sh
docker network create web            # один раз (если сети ещё нет)
cp .env.example .env && nano .env    # SECRET_KEY (тот же, что на ВМ!), OAuth-креды, TUNNEL_TOKEN
mkdir -p data                        # сюда лечь data.db с ВМ (scp) — runbook §4
ls -n ./data                         # сверить владельца data.db с user: в compose.yaml
docker compose up -d --build
```

Дальше — Public Hostname туннеля `report-analytics.ru -> http://caddy:80`, SSL/TLS = **Full**.
Публичный трафик переключать в ПОСЛЕДНЮЮ очередь (runbook §6); ВМ Yandex гасить —
только после успешной end-to-end проверки и первого бэкапа новой БД (runbook §8).
