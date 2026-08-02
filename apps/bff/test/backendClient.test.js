'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchCatalog, placeOrder } = require('../src/backendClient');

function fakeFetch(responses) {
  let call = 0;
  return async () => {
    const response = responses[call];
    call += 1;
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    };
  };
}

test('fetchCatalog returns parsed JSON on success', async () => {
  const items = [{ id: 1, name: 'Mug' }];
  const fetchImpl = fakeFetch([{ ok: true, status: 200, body: items }]);

  const result = await fetchCatalog(fetchImpl, 'http://backend:8080');

  assert.deepEqual(result, items);
});

test('fetchCatalog throws with the backend status on failure', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 503, body: {} }]);

  await assert.rejects(
    () => fetchCatalog(fetchImpl, 'http://backend:8080'),
    (err) => {
      assert.equal(err.statusCode, 503);
      return true;
    }
  );
});

test('placeOrder shapes the backend response into a confirmation', async () => {
  const fetchImpl = fakeFetch([
    { ok: true, status: 201, body: { id: 5, productId: 1, quantity: 2, totalCents: 2000 } },
  ]);

  const confirmation = await placeOrder(fetchImpl, 'http://backend:8080', {
    productId: 1,
    quantity: 2,
  });

  assert.deepEqual(confirmation, { orderId: 5, productId: 1, quantity: 2, totalCents: 2000 });
});

test('placeOrder propagates the backend error message and status', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 404, body: { error: 'product 99 not found' } }]);

  await assert.rejects(
    () => placeOrder(fetchImpl, 'http://backend:8080', { productId: 99, quantity: 1 }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.message, 'product 99 not found');
      return true;
    }
  );
});
