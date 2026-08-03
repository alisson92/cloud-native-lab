// Order creation/lookup. Price is looked up server-side from `products` —
// clients never dictate price. RabbitMQ publishing (Phase 6, docs/phases.md)
// happens here, after the Postgres transaction commits: the order write is
// the source of truth (docs/vision.md: "PostgreSQL | Transactional store for
// orders"), the queue message is a best-effort side effect notifying the
// worker to send an email/invoice. Kafka publishing (Phase 6 batch 2, a
// separate immutable-event-log role) is still out of scope for this file.
'use strict';

const { publishOrderCreated } = require('./rabbitmq');

async function createOrder(pgPool, { productId, quantity } = {}, rabbitmqChannel = null) {
  if (!productId || !quantity || quantity <= 0) {
    const err = new Error('productId and a positive quantity are required');
    err.statusCode = 400;
    throw err;
  }

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT price_cents FROM products WHERE id = $1', [
      productId,
    ]);
    if (rows.length === 0) {
      const err = new Error(`product ${productId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const totalCents = rows[0].price_cents * quantity;
    const insert = await client.query(
      'INSERT INTO orders (product_id, quantity, total_cents) VALUES ($1, $2, $3) RETURNING id',
      [productId, quantity, totalCents]
    );

    await client.query('COMMIT');
    const order = { id: insert.rows[0].id, productId, quantity, totalCents };

    // Publish only after COMMIT succeeds — never notify the worker about an
    // order that didn't actually persist. A publish failure must not fail
    // the HTTP response: the order is already durably written to Postgres,
    // and losing a best-effort email/invoice notification is an accepted
    // trade-off for this lab (see docs/adr/011-rabbitmq-plain-deployment.md).
    if (rabbitmqChannel) {
      try {
        publishOrderCreated(rabbitmqChannel, order);
      } catch (err) {
        console.error('failed to publish order-created message', err);
      }
    }

    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getOrder(pgPool, id) {
  const { rows } = await pgPool.query(
    'SELECT id, product_id AS "productId", quantity, total_cents AS "totalCents" FROM orders WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

module.exports = { createOrder, getOrder };
