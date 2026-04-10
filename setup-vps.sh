#!/bin/bash
# Dizipal Stremio Addon - VPS Setup Script
# Usage: curl -sL YOUR_RAW_URL | bash -s YOUR_VPS_IP

VPS_IP="72.62.145.53"

echo "==> Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git

echo "==> Cloning project..."
mkdir -p /opt/hasankoman
cd /opt/hasankoman
git clone https://github.com/hasankoman/dizipal-stremio-addon.git dizipal
cd dizipal

echo "==> Installing dependencies..."
npm install

echo "==> Creating .env..."
cat > .env << EOF
PORT=7000
HOSTING_URL=http://${VPS_IP}:7000
PROXY_URL=https://dizipal2042.com
URLGETSTATUS=false
EOF

echo "==> Installing PM2..."
npm install -g pm2

echo "==> Starting addon..."
pm2 start index.js --name dizipal
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "========================================="
echo "  Dizipal Addon kuruldu!"
echo "  Stremio URL: http://${VPS_IP}:7000/addon/manifest.json"
echo "  Website:     http://${VPS_IP}:7000"
echo "========================================="
