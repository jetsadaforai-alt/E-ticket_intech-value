FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# NEXT_PUBLIC_* vars must be present at `next build` time, not just container start —
# a plain docker-compose `environment:` entry would silently do nothing here.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm run build

EXPOSE 3001

# package.json's "start" script doesn't set a port, so it's
# passed explicitly here instead of via `npm start`.
CMD ["npx", "next", "start", "-p", "3001"]
