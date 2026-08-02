'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { heartbeat, HEARTBEAT_MESSAGE } = require('../src/heartbeat');

test('heartbeat logs the placeholder message via the injected logger', () => {
  let logged = null;

  heartbeat((msg) => {
    logged = msg;
  });

  assert.equal(logged, HEARTBEAT_MESSAGE);
  assert.match(logged, /Phase 6/);
});
