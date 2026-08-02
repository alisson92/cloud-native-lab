// Order creation/lookup. Price is looked up server-side from `products` —
// clients never dictate price. RabbitMQ/Kafka publishing on order creation
// is explicit Phase 6 scope (see docs/phases.md); nothing is stubbed here.
'use strict';

async function createOrder(pgPool, { productId, quantity } = {}) {
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
    return { id: insert.rows[0].id, productId, quantity, totalCents };
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
