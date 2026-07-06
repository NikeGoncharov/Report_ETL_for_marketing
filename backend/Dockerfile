# syntax=docker/dockerfile:1

########################################
# Builder: зависимости в изолированный venv
########################################
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Инструменты сборки — страховка на случай сборки колёс из sdist
# (bcrypt/cryptography обычно ставятся manylinux-колёсами и это не задействуется).
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libffi-dev \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

########################################
# Runtime: тонкий образ, без компиляторов, не root
########################################
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    # SQLite лежит на смонтированном томе /app/data, НЕ в слое образа.
    DATABASE_URL="sqlite+aiosqlite:////app/data/data.db" \
    DATABASE_URL_SYNC="sqlite:////app/data/data.db"

# Не-root пользователь с фиксированными UID/GID — предсказуемое владение томом.
RUN groupadd -g 10001 app \
 && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# alembic.ini + alembic/ должны лежать рядом с app/, чтобы `alembic upgrade head`
# разрешил script_location=alembic и prepend_sys_path=. из alembic.ini.
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./alembic.ini

# Админ-CLI (список юзеров, установка пароля). Запуск внутри контейнера:
#   docker compose exec report-backend python manage.py set-password <email> '<пароль>'
COPY manage.py ./manage.py

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/data && chown -R app:app /app
VOLUME ["/app/data"]

USER app
EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]
