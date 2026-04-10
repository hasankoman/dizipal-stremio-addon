FROM node:20-alpine

WORKDIR /app

COPY . .

RUN npm install

RUN cd frontend/netflix-clone && npm install && npm run build

CMD ["node", "index.js"]
