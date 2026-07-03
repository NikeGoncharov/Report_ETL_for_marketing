#!/bin/sh
set -e

# Каталог БД на смонтированном томе (bind-mount может стартовать пустым).
mkdir -p /app/data

# Схема ДО старта приложения. alembic/env.py берёт DATABASE_URL_SYNC из app.config,
# который читает наш env -> миграции применяются к БД на томе /app/data.
echo "Running alembic upgrade head..."
alembic upgrade head

# Как ExecStart прод-systemd, но слушаем все интерфейсы (Caddy ходит по внутренней
# сети 'web') и доверяем заголовкам вышестоящего прокси (proxy-headers).
echo "Starting uvicorn..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --proxy-headers \
    --forwarded-allow-ips="*"
