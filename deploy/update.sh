#!/bin/bash
# RePort Update Script
# Run as report user or root

set -e

echo "=== Updating RePort ==="

# Pull latest code
echo "Pulling latest code..."
cd /home/report/RePort
git pull

# Update backend dependencies
echo "Updating backend dependencies..."
/home/report/venv/bin/pip install -r backend/requirements.txt

# Run migrations
echo "Running database migrations..."
cd /home/report/RePort/backend
/home/report/venv/bin/alembic upgrade head

# Update frontend
echo "Building frontend..."
cd /home/report/RePort/frontend
npm install
npm run build

# Restart services
echo "Restarting services..."
sudo systemctl restart report-backend report-frontend

echo ""
echo "=== Update Complete ==="
echo "Check status: systemctl status report-backend report-frontend"
