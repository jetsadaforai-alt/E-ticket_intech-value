const http = require('http');
const app = require('./app');
const { startEventExpiryJob } = require('./services/eventExpiry');
const { initRealtime } = require('./services/realtime');

const port = process.env.PORT || 3000;
// http.createServer(app) instead of app.listen() so socket.io can share the same
// HTTP server/port — no second port to open in the firewall or proxy in Caddy.
const server = http.createServer(app);
initRealtime(server);

server.listen(port, () => {
  console.log(`E-ticket backend listening on port ${port}`);
  // Lives here rather than in app.js so importing the app for tests doesn't start a
  // background timer that mutates the database mid-test.
  startEventExpiryJob();
});
