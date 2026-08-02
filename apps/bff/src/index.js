'use strict';

const express = require('express');
const { fetchCatalog, placeOrder } = require('./backendClient');

const PORT = process.env.PORT || 8081;
const BACKEND_URL = process.env.BACKEND_URL;

function buildApp(fetchImpl = fetch) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/catalog', async (req, res, next) => {
    try {
      const items = await fetchCatalog(fetchImpl, BACKEND_URL);
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  app.post('/orders', async (req, res, next) => {
    try {
      const confirmation = await placeOrder(fetchImpl, BACKEND_URL, req.body);
      res.status(201).json(confirmation);
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Only intentional client errors (carrying an explicit statusCode) have
    // a message safe to return. Unexpected failures (e.g. backend/network
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
    console.log(`bff listening on port ${PORT}`);
  });
}

module.exports = { buildApp };
