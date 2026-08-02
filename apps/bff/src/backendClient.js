// Thin HTTP client for the backend service. Uses the Node 22 global `fetch`
// (undici, built in) — no extra HTTP client dependency needed.
'use strict';

async function fetchCatalog(fetchImpl, backendUrl) {
  const res = await fetchImpl(`${backendUrl}/catalog`);
  if (!res.ok) {
    const err = new Error(`backend /catalog responded with ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
  return res.json();
}

// Proxies order creation and reshapes the backend's row into the
// confirmation shape the frontend renders (order id, item, total).
async function placeOrder(fetchImpl, backendUrl, { productId, quantity } = {}) {
  const res = await fetchImpl(`${backendUrl}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantity }),
  });
  const body = await res.json();

  if (!res.ok) {
    const err = new Error(body.error || `backend /orders responded with ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }

  return {
    orderId: body.id,
    productId: body.productId,
    quantity: body.quantity,
    totalCents: body.totalCents,
  };
}

module.exports = { fetchCatalog, placeOrder };
