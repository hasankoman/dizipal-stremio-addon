FROM node:20-alpine

RUN apk add --no-cache python3 py3-pip ffmpeg
RUN pip3 install --break-system-packages yt-dlp

WORKDIR /app

COPY . .

RUN npm install

RUN cd frontend/netflix-clone && npm install && npm run build

CMD ["node", "index.js"]
