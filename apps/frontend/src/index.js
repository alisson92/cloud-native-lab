// Serves the static storefront page and proxies its API calls to the BFF.
// The browser only ever talks to this service's origin (/api/*); the BFF
// stays a cluster-internal address, never exposed to the client directly.
'use strict';

const path = require('node:path');
const express = require('express');
const { fetchCatalog, placeOrder } = require('./bffClient');

const PORT = process.env.PORT || 8082;
const BFF_URL = process.env.BFF_URL;

function buildApp(fetchImpl = fetch) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/catalog', async (req, res, next) => {
    try {
      const items = await fetchCatalog(fetchImpl, BFF_URL);
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/orders', async (req, res, next) => {
    try {
      const confirmation = await placeOrder(fetchImpl, BFF_URL, req.body);
      res.status(201).json(confirmation);
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Only intentional client errors (carrying an explicit statusCode) have
    // a message safe to return. Unexpected failures (e.g. BFF/network
    // errors) default to 500 and must never echo err.message — it can
    // contain upstream connection details. Mirrors apps/backend/src/index.js.
    const statusCode = err.statusCode || 500;
    const message = err.statusCode ? err.message : 'internal server error';
    if (!err.statusCode) {
      console.error('unhandled request error', err);
    }
    res.status(statusCode).json({ error: message });
  });

  return app;
}

if (require.main === module) {
  buildApp().listen(PORT, () => {
    console.log(`frontend listening on port ${PORT}`);
  });
}

module.exports = { buildApp };
