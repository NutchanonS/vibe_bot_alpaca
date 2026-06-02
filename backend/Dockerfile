FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD wget -qO- http://localhost:8000/health || exit 1

EXPOSE 8000
CMD ["node", "src/index.js"]
