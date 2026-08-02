// Thin HTTP client for the BFF. Uses the Node 22 global `fetch` (undici,
// built in) — no extra HTTP client dependency needed. Mirrors
// apps/bff/src/backendClient.js's shape by design (same one-hop proxy
// pattern, one layer down).
'use strict';

async function fetchCatalog(fetchImpl, bffUrl) {
  const res = await fetchImpl(`${bffUrl}/catalog`);
  if (!res.ok) {
    const err = new Error(`bff /catalog responded with ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
  return res.json();
}

async function placeOrder(fetchImpl, bffUrl, { productId, quantity } = {}) {
  const res = await fetchImpl(`${bffUrl}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantity }),
  });
  const body = await res.json();

  if (!res.ok) {
    const err = new Error(body.error || `bff /orders responded with ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }

  return body;
}

module.exports = { fetchCatalog, placeOrder };
