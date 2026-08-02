// Redis client factory. Config comes entirely from env vars fed by External
// Secrets in gitops/ — never hardcoded here.
// Client API grounded in https://redis.io/docs/latest/develop/clients/nodejs/connect/
'use strict';

const { createClient } = require('redis');

function createRedisClient() {
  return createClient({
    socket: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });
}

module.exports = { createRedisClient };
