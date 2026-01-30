#!/bin/bash
# RePort Server Setup Script
# Run as root: sudo bash setup.sh

set -e

echo "=== RePort Server Setup ==="

# 1. Create user
echo "Creating user 'report'..."
useradd -m -s /bin/bash report || echo "User 'report' already exists"

# 2. Install dependencies
echo "Installing system dependencies..."
apt update
apt install -y python3 python3-pip python3-venv nodejs npm nginx certbot python3-certbot-nginx

# 3. Create directories
echo "Creating directories..."
mkdir -p /home/report/data
mkdir -p /home/report/backups
mkdir -p /var/log/report
chown -R report:report /home/report
chown -R report:report /var/log/report

# 4. Clone repository (if not exists)
if [ ! -d "/home/report/RePort" ]; then
    echo "Cloning repository..."
    su - report -c "git clone https://github.com/YOUR_USERNAME/RePort.git"
else
    echo "Repository already exists, pulling latest..."
    su - report -c "cd /home/report/RePort && git pull"
fi

# 5. Setup Python venv
echo "Setting up Python virtual environment..."
su - report -c "python3 -m venv /home/report/venv"
su - report -c "/home/report/venv/bin/pip install --upgrade pip"
su - report -c "/home/report/venv/bin/pip install -r /home/report/RePort/backend/requirements.txt"

# 6. Setup Frontend
echo "Building frontend..."
su - report -c "cd /home/report/RePort/frontend && npm install && npm run build"

# 7. Create .env files
if [ ! -f "/home/report/RePort/backend/.env" ]; then
    echo "Creating backend .env file..."
    cat > /home/report/RePort/backend/.env << EOF
ENVIRONMENT=production
SECRET_KEY=$(openssl rand -hex 32)
DATABASE_URL=sqlite+aiosqlite:////home/report/data/data.db
DATABASE_URL_SYNC=sqlite:////home/report/data/data.db
FRONTEND_URL=https://report-analytics.ru
COOKIE_SECURE=true
YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
YANDEX_REDIRECT_URI=https://report-analytics.ru/integrations/yandex/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://report-analytics.ru/integrations/google/callback
EOF
    chown report:report /home/report/RePort/backend/.env
    echo "!!! Don't forget to update .env with your domain and OAuth credentials !!!"
fi

# Frontend uses same-origin API calls in production (via nginx proxy)
# No .env needed for frontend in production

# 8. Run database migrations
echo "Running database migrations..."
su - report -c "cd /home/report/RePort/backend && /home/report/venv/bin/alembic upgrade head"

# 9. Install systemd services
echo "Installing systemd services..."
cp /home/report/RePort/deploy/report-backend.service /etc/systemd/system/
cp /home/report/RePort/deploy/report-frontend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable report-backend report-frontend
systemctl start report-backend report-frontend

# 10. Configure Nginx
echo "Configuring Nginx..."
cp /home/report/RePort/deploy/nginx.conf /etc/nginx/sites-available/report
ln -sf /etc/nginx/sites-available/report /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 11. Setup backup cron job
echo "Setting up backup cron job..."
cat > /etc/cron.d/report-backup << EOF
# Backup RePort database daily at 3am
0 3 * * * report cp /home/report/data/data.db /home/report/backups/data_\$(date +\%Y\%m\%d).db
# Keep only last 30 backups
0 4 * * * report find /home/report/backups -name "data_*.db" -mtime +30 -delete
EOF

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Run: sudo certbot --nginx -d report-analytics.ru -d www.report-analytics.ru"
echo "2. Update /home/report/RePort/backend/.env with your OAuth credentials (optional)"
echo "3. Restart services: sudo systemctl restart report-backend report-frontend"
echo ""
echo "Check status: systemctl status report-backend report-frontend"
echo "View logs: journalctl -u report-backend -f"
echo ""
echo "Your site will be available at: https://report-analytics.ru"
