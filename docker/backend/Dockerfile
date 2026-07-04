# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY server.ts ./
COPY src ./src
RUN npx prisma generate

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./
COPY docker/backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
