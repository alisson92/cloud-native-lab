'use strict';

const express = require('express');
const { createPool, bootstrapSchema } = require('./db');
const { createRedisClient } = require('./redis');
const { getCatalog } = require('./catalog');
const { createOrder, getOrder } = require('./orders');

const PORT = process.env.PORT || 8080;

async function main() {
  const pgPool = createPool();
  const redisClient = createRedisClient();

  await bootstrapSchema(pgPool);
  await redisClient.connect();

  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/catalog', async (req, res, next) => {
    try {
      const items = await getCatalog(pgPool, redisClient);
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  app.post('/orders', async (req, res, next) => {
    try {
      const order = await createOrder(pgPool, req.body);
      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  });

  app.get('/orders/:id', async (req, res, next) => {
    try {
      const order = await getOrder(pgPool, req.params.id);
      if (!order) {
        res.status(404).json({ error: 'order not found' });
        return;
      }
      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Only intentional client errors (orders.js sets `statusCode` on them)
    // carry a message safe to return. Unexpected failures (DB/Redis errors,
    // etc.) default to 500 and must never echo `err.message` back to the
    // client — that can leak connection details, SQL, or stack info.
    const statusCode = err.statusCode || 500;
    const message = err.statusCode ? err.message : 'internal server error';
    if (!err.statusCode) {
      console.error('unhandled request error', err);
    }
    res.status(statusCode).json({ error: message });
  });

  app.listen(PORT, () => {
    console.log(`backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('backend failed to start', err);
  process.exit(1);
});
