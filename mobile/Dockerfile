FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8081

# LAN mode is Expo's default — no flag needed. REACT_NATIVE_PACKAGER_HOSTNAME and
# EXPO_PUBLIC_API_BASE_URL come from docker-compose.yml's environment block.
CMD ["npx", "expo", "start"]
