FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p /app/data /app/backups/local /app/backups/gdrive

ENV NODE_ENV=production
ENV PORT=8181
ENV BACKUP_DIR_LOCAL=/app/backups/local
ENV BACKUP_DIR_CLOUD=/app/backups/gdrive
ENV BACKUP_KEEP=15

EXPOSE 8181

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8181) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
