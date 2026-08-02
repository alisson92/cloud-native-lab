// Cache-aside catalog lookup: Redis is the read path's fast source, Postgres
// is the source of truth. Per docs/vision.md, Redis's whole role in this lab
// is "catalog cache and sessions" — this is that role, not a no-op touch.
'use strict';

const CACHE_KEY = 'catalog:items';
const CACHE_TTL_SECONDS = 60;

async function getCatalog(pgPool, redisClient) {
  const cached = await redisClient.get(CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  const { rows } = await pgPool.query('SELECT id, name, price_cents FROM products ORDER BY id');
  await redisClient.set(CACHE_KEY, JSON.stringify(rows), { EX: CACHE_TTL_SECONDS });
  return rows;
}

module.exports = { getCatalog, CACHE_KEY, CACHE_TTL_SECONDS };
