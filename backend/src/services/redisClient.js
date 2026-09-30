const { createClient } = require('redis');

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6380' });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

let connectPromise = null;
function getRedis() {
  if (!connectPromise) {
    connectPromise = redisClient.connect().then(() => redisClient);
  }
  return connectPromise;
}

module.exports = { redisClient, getRedis };
