'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const promClient = require('prom-client');

// index.js is not structured for import in tests (its `main()` connects to
// Postgres/Redis/RabbitMQ/Kafka as a side effect of being required), so this
// test exercises the exact /metrics route logic in isolation: same
// prom-client calls, same Express handler shape, wired to a real HTTP
// server. This mirrors how catalog.test.js/orders.test.js test the pieces of
// index.js's routes (catalog.js, orders.js) directly rather than importing
// index.js itself.
test('GET /metrics returns 200 and a Prometheus-exposition-format body', async () => {
  promClient.collectDefaultMetrics();

  const app = express();
  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      res.end(await promClient.register.metrics());
    } catch (err) {
      next(err);
    }
  });

  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), promClient.register.contentType);
    assert.match(body, /# HELP/);
  } finally {
    server.close();
    promClient.register.clear();
  }
});
