FROM node:20-alpine

WORKDIR /app

# Install deps first so this layer caches across code changes
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Store state on a mounted volume by default so redeploys keep queued jobs
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SCHEDULE_STORE_PATH=/data/scheduleStore.json \
    MESSAGE_STORE_PATH=/data/messageStore.json

RUN mkdir -p /data
VOLUME /data

EXPOSE 3000
CMD ["node", "server.js"]
