# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

# ---- runner ----
FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
