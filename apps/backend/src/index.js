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
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  });

  app.listen(PORT, () => {
    console.log(`backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('backend failed to start', err);
  process.exit(1);
});
