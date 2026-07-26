#!/bin/bash
# KomanMovie Stremio Addon - VPS Setup Script
# Kullanim: TMDB_TOKEN="eyJhbGci..." bash setup-vps.sh
set -e

VPS_IP="72.62.145.53"

# TMDB_TOKEN olmadan IMDB -> icerik eslemesi calismaz ve addon hicbir stream
# dondurmez. Repoya gomulmemesi icin ortamdan aliniyor.
if [ -z "${TMDB_TOKEN}" ]; then
  echo "HATA: TMDB_TOKEN tanimli degil."
  echo "Kullanim: TMDB_TOKEN=\"eyJhbGci...\" bash setup-vps.sh"
  exit 1
fi

echo "==> Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git

echo "==> Cloning project..."
mkdir -p /opt/hasankoman
cd /opt/hasankoman
if [ -d dizipal/.git ]; then
  cd dizipal && git pull
else
  git clone https://github.com/hasankoman/dizipal-stremio-addon.git dizipal
  cd dizipal
fi

echo "==> Installing dependencies..."
npm install

echo "==> Creating .env..."
cat > .env << EOF
PORT=7000
HOSTING_URL=http://${VPS_IP}:7000
PROXY_URL=https://dizipal2089.com
URLGETSTATUS=false
TMDB_TOKEN=${TMDB_TOKEN}
EOF

echo "==> Installing PM2..."
npm install -g pm2

echo "==> Starting addon..."
pm2 delete dizipal 2>/dev/null || true
pm2 start index.js --name dizipal
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "========================================="
echo "  KomanMovie Addon kuruldu!"
echo "  Stremio URL: http://${VPS_IP}:7000/manifest.json"
echo "  Website:     http://${VPS_IP}:7000"
echo ""
echo "  HTTPS icin: bash setup-nginx.sh"
echo "========================================="
