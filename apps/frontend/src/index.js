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
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  });

  return app;
}

if (require.main === module) {
  buildApp().listen(PORT, () => {
    console.log(`frontend listening on port ${PORT}`);
  });
}

module.exports = { buildApp };
