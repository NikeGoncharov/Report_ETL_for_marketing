#!/bin/bash
# RePort Update Script
# Run as report user or root

set -e

APP_USER="user"
APP_HOME="/home/$APP_USER"
APP_DIR="$APP_HOME/RePort"

echo "=== Updating RePort ==="

# Pull latest code
echo "Pulling latest code..."
cd $APP_DIR
git pull

# Update backend dependencies
echo "Updating backend dependencies..."
$APP_HOME/venv/bin/pip install -r backend/requirements.txt

# Run migrations
echo "Running database migrations..."
cd $APP_DIR/backend
$APP_HOME/venv/bin/alembic upgrade head

# Update frontend
echo "Building frontend..."
cd $APP_DIR/frontend
npm install
npm run build

# Restart services
echo "Restarting services..."
sudo systemctl restart report-backend report-frontend

echo ""
echo "=== Update Complete ==="
echo "Check status: systemctl status report-backend report-frontend"
