#!/bin/bash
# Nginx + HTTPS setup for movie.hasankoman.dev
set -e

DOMAIN="movie.hasankoman.dev"
EMAIL="hasan@hasankoman.dev"

apt install -y nginx certbot python3-certbot-nginx

# proxy_buffering off sart: HLS segmentleri (2 MB civari) istemciye aninda
# akmali; nginx tamamini tamponlarsa oynatma gecikir ve ileri sarma takilir.
cat > /etc/nginx/sites-available/movie << 'NGINXCONF'
server {
    listen 80;
    server_name movie.hasankoman.dev;

    location / {
        proxy_pass http://127.0.0.1:7000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINXCONF

ln -sf /etc/nginx/sites-available/movie /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}"

cd /opt/hasankoman/dizipal
sed -i "s|HOSTING_URL=.*|HOSTING_URL=https://${DOMAIN}|" .env
pm2 restart dizipal

echo ""
echo "========================================="
echo "  HTTPS kuruldu!"
echo "  Stremio: https://${DOMAIN}/manifest.json"
echo "  Website: https://${DOMAIN}"
echo "========================================="
