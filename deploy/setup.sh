#!/bin/bash
# Report Server Setup Script
# Run as root: sudo bash setup.sh
#
# ВНИМАНИЕ: это раскладка АРЕНДОВАННОЙ ВМ (nginx + certbot + systemd), с которой
# прод уехал 04.07.2026. Актуальный деплой — Docker за Cloudflare Tunnel:
# deploy/homeserver/README.md. Скрипт оставлен как справка по «голой» установке.

set -e

# Configuration - change if needed
APP_USER="user"
APP_HOME="/home/$APP_USER"
APP_DIR="$APP_HOME/Report"

echo "=== Report Server Setup ==="
echo "User: $APP_USER"
echo "Directory: $APP_DIR"
echo ""

# 1. Install dependencies
echo "Installing system dependencies..."
apt update
apt install -y python3 python3-pip python3-venv nginx certbot python3-certbot-nginx

# Check if Node.js is installed (user might have nvm)
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    apt install -y nodejs npm
else
    echo "Node.js already installed: $(node -v)"
fi

# 2. Create directories
echo "Creating directories..."
mkdir -p $APP_HOME/data
mkdir -p $APP_HOME/backups
mkdir -p /var/log/report
chown -R $APP_USER:$APP_USER $APP_HOME/data
chown -R $APP_USER:$APP_USER $APP_HOME/backups
chown -R $APP_USER:$APP_USER /var/log/report

# 3. Setup Python venv
echo "Setting up Python virtual environment..."
su - $APP_USER -c "python3 -m venv $APP_HOME/venv"
su - $APP_USER -c "$APP_HOME/venv/bin/pip install --upgrade pip"
su - $APP_USER -c "$APP_HOME/venv/bin/pip install -r $APP_DIR/backend/requirements.txt"

# 4. Setup Frontend
echo "Building frontend..."
su - $APP_USER -c "cd $APP_DIR/frontend && npm install && npm run build"

# 5. Create .env file
if [ ! -f "$APP_DIR/backend/.env" ]; then
    echo "Creating backend .env file..."
    cat > $APP_DIR/backend/.env << EOF
ENVIRONMENT=production
SECRET_KEY=$(openssl rand -hex 32)
DATABASE_URL=sqlite+aiosqlite:///$APP_HOME/data/data.db
DATABASE_URL_SYNC=sqlite:///$APP_HOME/data/data.db
FRONTEND_URL=https://report-analytics.ru
COOKIE_SECURE=true
YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
# nginx проксирует на бэкенд только /api/* (срезая префикс), поэтому
# callback-URI обязан содержать /api — иначе редирект уйдёт во фронтенд (404).
YANDEX_REDIRECT_URI=https://report-analytics.ru/api/integrations/yandex/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://report-analytics.ru/api/integrations/google/callback
EOF
    chown $APP_USER:$APP_USER $APP_DIR/backend/.env
fi

# 6. Run database migrations
echo "Running database migrations..."
su - $APP_USER -c "cd $APP_DIR/backend && $APP_HOME/venv/bin/alembic upgrade head"

# 7. Create systemd services
echo "Creating systemd services..."

cat > /etc/systemd/system/report-backend.service << EOF
[Unit]
Description=Report Backend (FastAPI)
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
Environment="PATH=$APP_HOME/venv/bin"
ExecStart=$APP_HOME/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=10

# Logging
StandardOutput=append:/var/log/report/backend.log
StandardError=append:/var/log/report/backend-error.log

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/report-frontend.service << EOF
[Unit]
Description=Report Frontend (Next.js)
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/frontend
ExecStart=$(which npm) start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

# Logging
StandardOutput=append:/var/log/report/frontend.log
StandardError=append:/var/log/report/frontend-error.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable report-backend report-frontend
systemctl start report-backend report-frontend

# 8. Configure Nginx
echo "Configuring Nginx..."
cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/report
ln -sf /etc/nginx/sites-available/report /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 9. Setup backups
# Прежний крон здесь делал `cp data.db ...` — это НЕБЕЗОПАСНО: база работает в
# режиме WAL, и копия одного основного файла молча теряет уже зафиксированные
# транзакции. Плюс `find -mtime +30 -delete` при простое сервиса вычищал каталог
# до нуля. Копии снимает и проверяет backend/scripts/backup_db.py.
echo "Setting up backups..."
# Каталог создаём ЗДЕСЬ и сразу с нужным владельцем. Скрипт создал бы его сам,
# но выставил бы 0700 от root (setup.sh идёт под sudo), и крон под $APP_USER
# потом каждую ночь падал бы на PermissionError, а `check` рапортовал бы
# «ни одной копии», потому что glob по нечитаемому каталогу молча пуст.
mkdir -p "$APP_HOME/backups/report"
chown -R $APP_USER:$APP_USER "$APP_HOME/backups"
chmod 700 "$APP_HOME/backups/report"

cat > /etc/cron.d/report-backup << EOF
# Ежедневная проверенная копия базы + ежедневная проверка свежести копий.
# Схема с systemd-таймерами и полный ранбук: deploy/homeserver/BACKUP.md
30 3 * * * $APP_USER /usr/bin/python3 $APP_DIR/backend/scripts/backup_db.py --db $APP_HOME/data/data.db --dest $APP_HOME/backups/report backup
0 12 * * * $APP_USER /usr/bin/python3 $APP_DIR/backend/scripts/backup_db.py --dest $APP_HOME/backups/report check
EOF

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Run: sudo certbot --nginx -d report-analytics.ru -d www.report-analytics.ru"
echo "2. Update $APP_DIR/backend/.env with your OAuth credentials (optional)"
echo "3. Restart services: sudo systemctl restart report-backend report-frontend"
echo ""
echo "Check status: systemctl status report-backend report-frontend"
echo "View logs: journalctl -u report-backend -f"
echo ""
echo "Your site will be available at: https://report-analytics.ru"
