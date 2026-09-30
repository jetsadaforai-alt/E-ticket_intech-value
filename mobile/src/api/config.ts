// Backend base URL, baked in at build time from EXPO_PUBLIC_API_BASE_URL:
// - `docker compose up` sets it to http://$HOST_LAN_IP:3000 (see docker-compose.yml + .env.example)
// - EAS builds take it from the build profile's env in eas.json
// - `npx expo start` outside Docker: export it yourself. A physical phone needs your
//   machine's LAN IP — 'localhost' would point at the phone itself.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';
