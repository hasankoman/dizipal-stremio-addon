#!/bin/bash
# Docker + Traefik setup for movie.hasankoman.dev

echo "==> Creating Dockerfile..."
cat > /opt/hasankoman/dizipal/Dockerfile << 'DEOF'
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 7000
CMD ["npm", "start"]
DEOF

echo "==> Creating docker-compose.yml..."
cat > /opt/hasankoman/dizipal/docker-compose.yml << 'DEOF'
services:
  movie:
    build: .
    restart: always
    environment:
      - PORT=7000
      - HOSTING_URL=https://movie.hasankoman.dev
      - PROXY_URL=https://dizipal2043.com
      - URLGETSTATUS=false
    labels:
      - traefik.enable=true
      - traefik.http.routers.movie.rule=Host(`movie.hasankoman.dev`)
      - traefik.http.routers.movie.tls=true
      - traefik.http.routers.movie.entrypoints=web,websecure
      - traefik.http.routers.movie.tls.certresolver=mytlschallenge
      - traefik.http.services.movie.loadbalancer.server.port=7000
    networks:
      - n8n_default

networks:
  n8n_default:
    external: true
DEOF

echo "==> Stopping PM2..."
pm2 stop dizipal 2>/dev/null
pm2 delete dizipal 2>/dev/null

echo "==> Building and starting Docker container..."
cd /opt/hasankoman/dizipal
docker compose up -d --build

echo ""
echo "========================================="
echo "  Movie addon kuruldu!"
echo "  Stremio: https://movie.hasankoman.dev/addon/manifest.json"
echo "  Website: https://movie.hasankoman.dev"
echo "========================================="
