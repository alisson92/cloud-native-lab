'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOrder, getOrder } = require('../src/orders');

function fakeClient(productRows) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT price_cents')) return { rows: productRows };
      if (sql.startsWith('INSERT INTO orders')) return { rows: [{ id: 42 }] };
      return { rows: [] };
    },
    release: () => {},
  };
}

test('createOrder computes the total from the product price and commits', async () => {
  const client = fakeClient([{ price_cents: 500 }]);
  const pool = { connect: async () => client };

  const order = await createOrder(pool, { productId: 1, quantity: 3 });

  assert.equal(order.id, 42);
  assert.equal(order.totalCents, 1500);
  assert.ok(client.queries.some((q) => q.sql === 'BEGIN'));
  assert.ok(client.queries.some((q) => q.sql === 'COMMIT'));
});

test('createOrder rejects an unknown product with 404 and rolls back', async () => {
  const client = fakeClient([]);
  const pool = { connect: async () => client };

  await assert.rejects(
    () => createOrder(pool, { productId: 99, quantity: 1 }),
    (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
  assert.ok(client.queries.some((q) => q.sql === 'ROLLBACK'));
});

test('createOrder rejects an invalid quantity before touching Postgres', async () => {
  const pool = {
    connect: async () => {
      throw new Error('must not connect for invalid input');
    },
  };

  await assert.rejects(
    () => createOrder(pool, { productId: 1, quantity: 0 }),
    /positive quantity/
  );
});

test('getOrder returns null when the order does not exist', async () => {
  const pool = { query: async () => ({ rows: [] }) };

  const result = await getOrder(pool, 123);

  assert.equal(result, null);
});

test('createOrder publishes an order-created message after commit', async () => {
  const client = fakeClient([{ price_cents: 500 }]);
  const pool = { connect: async () => client };
  const published = [];
  const fakeChannel = {
    sendToQueue: (queue, payload, opts) => {
      published.push({ queue, payload: JSON.parse(payload.toString()), opts });
    },
  };

  const order = await createOrder(pool, { productId: 1, quantity: 2 }, fakeChannel);

  assert.equal(published.length, 1);
  assert.equal(published[0].queue, 'orders.created');
  assert.deepEqual(published[0].payload, order);
  assert.equal(published[0].opts.persistent, true);
});

test('createOrder does not fail the request if publishing fails', async () => {
  const client = fakeClient([{ price_cents: 500 }]);
  const pool = { connect: async () => client };
  const fakeChannel = {
    sendToQueue: () => {
      throw new Error('broker unreachable');
    },
  };

  const order = await createOrder(pool, { productId: 1, quantity: 1 }, fakeChannel);

  assert.equal(order.totalCents, 500);
  assert.ok(client.queries.some((q) => q.sql === 'COMMIT'));
});

test('createOrder publishes an order-created event to Kafka after commit', async () => {
  const client = fakeClient([{ price_cents: 500 }]);
  const pool = { connect: async () => client };
  const sent = [];
  const fakeProducer = {
    send: async ({ topic, messages }) => {
      sent.push({ topic, messages });
    },
  };

  const order = await createOrder(pool, { productId: 1, quantity: 2 }, null, fakeProducer);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].topic, 'order-events');
  assert.equal(sent[0].messages[0].key, String(order.id));
  assert.deepEqual(JSON.parse(sent[0].messages[0].value), { type: 'order.created', order });
});

test('createOrder does not fail the request if the Kafka publish fails', async () => {
  const client = fakeClient([{ price_cents: 500 }]);
  const pool = { connect: async () => client };
  const fakeProducer = {
    send: async () => {
      throw new Error('broker unreachable');
    },
  };

  const order = await createOrder(pool, { productId: 1, quantity: 1 }, null, fakeProducer);

  assert.equal(order.totalCents, 500);
  assert.ok(client.queries.some((q) => q.sql === 'COMMIT'));
});
