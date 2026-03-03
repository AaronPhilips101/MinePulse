FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY server.js ./
COPY public/ ./public/

# Environment defaults (override at runtime)
ENV PORT=3000 \
    MC_HOST=your.minecraft.server \
    MC_PORT=25565 \
    POLL_INTERVAL=30000

EXPOSE 3000

CMD ["node", "server.js"]
