# Backend (Node/Express) image for the ReleaseIt COD app.
FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
