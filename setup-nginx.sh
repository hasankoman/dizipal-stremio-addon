#!/bin/bash
# Nginx + HTTPS setup for movie.hasankoman.dev

apt install -y nginx certbot python3-certbot-nginx

printf 'server {\n    listen 80;\n    server_name movie.hasankoman.dev;\n    location / {\n        proxy_pass http://127.0.0.1:7000;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_buffering off;\n        proxy_read_timeout 300s;\n    }\n}\n' > /etc/nginx/sites-available/movie

ln -sf /etc/nginx/sites-available/movie /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

certbot --nginx -d movie.hasankoman.dev --non-interactive --agree-tos -m hasan@hasankoman.dev

cd /opt/hasankoman/dizipal
sed -i 's|HOSTING_URL=.*|HOSTING_URL=https://movie.hasankoman.dev|' .env
pm2 restart dizipal

echo ""
echo "========================================="
echo "  HTTPS kuruldu!"
echo "  Stremio: https://movie.hasankoman.dev/addon/manifest.json"
echo "  Website: https://movie.hasankoman.dev"
echo "========================================="

