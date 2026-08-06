'use strict';

const express = require('express');
const promClient = require('prom-client');
const { createPool, bootstrapSchema } = require('./db');
const { createRedisClient } = require('./redis');
const { createRabbitMQChannel } = require('./rabbitmq');
const { createKafkaProducer } = require('./kafka');
const { getCatalog } = require('./catalog');
const { createOrder, getOrder } = require('./orders');

const PORT = process.env.PORT || 8080;

// Node.js process/event-loop metrics (CPU, memory, GC, event-loop lag, etc.),
// collected on the library's default registry. Per prom-client's own example
// (https://github.com/siimon/prom-client/blob/master/example/server.js),
// `collectDefaultMetrics()` is called once at module load and the same
// `promClient.register` singleton is scraped by the /metrics route below.
promClient.collectDefaultMetrics();

async function main() {
  const pgPool = createPool();
  const redisClient = createRedisClient();

  await bootstrapSchema(pgPool);
  await redisClient.connect();
  const rabbitmqChannel = await createRabbitMQChannel();
  const kafkaProducer = await createKafkaProducer();

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
      const order = await createOrder(pgPool, req.body, rabbitmqChannel, kafkaProducer);
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

  app.get('/metrics', async (req, res, next) => {
    try {
      // Same trust boundary as /health: this Service is ClusterIP,
      // scraped in-cluster only (e.g. by kube-prometheus-stack), so no
      // auth is added here — matches the example in prom-client's README.
      res.set('Content-Type', promClient.register.contentType);
      res.end(await promClient.register.metrics());
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
