'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCatalog, CACHE_KEY, CACHE_TTL_SECONDS } = require('../src/catalog');

test('getCatalog returns the cached value on a cache hit without querying Postgres', async () => {
  const cachedItems = [{ id: 1, name: 'Cached Item', price_cents: 100 }];
  let pgQueried = false;

  const fakePool = {
    query: async () => {
      pgQueried = true;
      return { rows: [] };
    },
  };
  const fakeRedis = {
    get: async (key) => {
      assert.equal(key, CACHE_KEY);
      return JSON.stringify(cachedItems);
    },
    set: async () => {
      throw new Error('set must not be called on a cache hit');
    },
  };

  const result = await getCatalog(fakePool, fakeRedis);

  assert.deepEqual(result, cachedItems);
  assert.equal(pgQueried, false);
});

test('getCatalog queries Postgres and populates the cache on a cache miss', async () => {
  const dbRows = [{ id: 1, name: 'DB Item', price_cents: 200 }];
  let setCall = null;

  const fakePool = {
    query: async () => ({ rows: dbRows }),
  };
  const fakeRedis = {
    get: async () => null,
    set: async (key, value, opts) => {
      setCall = { key, value, opts };
    },
  };

  const result = await getCatalog(fakePool, fakeRedis);

  assert.deepEqual(result, dbRows);
  assert.equal(setCall.key, CACHE_KEY);
  assert.deepEqual(JSON.parse(setCall.value), dbRows);
  assert.equal(setCall.opts.EX, CACHE_TTL_SECONDS);
});
