FROM node:20-alpine

WORKDIR /app

# Prisma's query engine needs OpenSSL on Alpine (glibc-free) images. curl is used
# by docker-entrypoint.sh to wait for the server before seeding demo data.
RUN apk add --no-cache openssl curl

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3000

# migrate/seed/seed:demo run on every container start — all are idempotent already
# (see docker-entrypoint.sh), so this is safe to repeat and means a fresh
# `docker compose up` needs zero manual setup commands.
CMD ["sh", "docker-entrypoint.sh"]
