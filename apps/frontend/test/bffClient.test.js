'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchCatalog, placeOrder } = require('../src/bffClient');

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

  const result = await fetchCatalog(fetchImpl, 'http://bff:8081');

  assert.deepEqual(result, items);
});

test('fetchCatalog throws with the bff status on failure', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 502, body: {} }]);

  await assert.rejects(
    () => fetchCatalog(fetchImpl, 'http://bff:8081'),
    (err) => {
      assert.equal(err.statusCode, 502);
      return true;
    }
  );
});

test('placeOrder returns the bff confirmation body on success', async () => {
  const confirmation = { orderId: 5, productId: 1, quantity: 1, totalCents: 1299 };
  const fetchImpl = fakeFetch([{ ok: true, status: 201, body: confirmation }]);

  const result = await placeOrder(fetchImpl, 'http://bff:8081', { productId: 1, quantity: 1 });

  assert.deepEqual(result, confirmation);
});

test('placeOrder propagates the bff error message and status', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 404, body: { error: 'product 99 not found' } }]);

  await assert.rejects(
    () => placeOrder(fetchImpl, 'http://bff:8081', { productId: 99, quantity: 1 }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.message, 'product 99 not found');
      return true;
    }
  );
});
