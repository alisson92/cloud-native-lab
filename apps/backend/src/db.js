// PostgreSQL access: connection pool, idempotent schema bootstrap, and demo
// seed data. No migration framework — a deliberate lab-scale simplification
// (see docs/phases.md, Phase 5) since this schema never evolves in this lab.
'use strict';

const { Pool } = require('pg');

function createPool() {
  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });
}

const DEMO_PRODUCTS = [
  { name: 'Coffee Mug', priceCents: 1299 },
  { name: 'Notebook', priceCents: 599 },
  { name: 'Sticker Pack', priceCents: 399 },
];

// Runs on every startup. CREATE TABLE IF NOT EXISTS makes it idempotent;
// the products seed only inserts when the table is empty.
async function bootstrapSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products (id),
      quantity INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*) FROM products');
  if (Number(rows[0].count) === 0) {
    for (const product of DEMO_PRODUCTS) {
      await pool.query('INSERT INTO products (name, price_cents) VALUES ($1, $2)', [
        product.name,
        product.priceCents,
      ]);
    }
  }
}

module.exports = { createPool, bootstrapSchema, DEMO_PRODUCTS };
