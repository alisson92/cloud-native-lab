'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startConsumer, handleOrderCreated, ORDER_CREATED_QUEUE } = require('../src/rabbitmq');

function fakeChannel() {
  let handler;
  const acked = [];
  const nacked = [];
  return {
    consume: (queue, cb) => {
      assert.equal(queue, ORDER_CREATED_QUEUE);
      handler = cb;
      return Promise.resolve({ consumerTag: 'test' });
    },
    ack: (msg) => acked.push(msg),
    nack: (msg, allUpTo, requeue) => nacked.push({ msg, allUpTo, requeue }),
    deliver: (payload) => handler({ content: Buffer.from(JSON.stringify(payload)) }),
    deliverRaw: (content) => handler({ content }),
    acked,
    nacked,
  };
}

test('startConsumer acks a well-formed order-created message after handling it', async () => {
  const channel = fakeChannel();
  const handled = [];

  await startConsumer(channel, (order) => handled.push(order));
  channel.deliver({ id: 1, productId: 2, quantity: 3, totalCents: 900 });

  assert.equal(handled.length, 1);
  assert.equal(handled[0].id, 1);
  assert.equal(channel.acked.length, 1);
  assert.equal(channel.nacked.length, 0);
});

test('startConsumer nacks without requeue on an unparsable message', async () => {
  const channel = fakeChannel();

  await startConsumer(channel, () => {
    throw new Error('should not be called');
  });
  channel.deliverRaw(Buffer.from('not json'));

  assert.equal(channel.acked.length, 0);
  assert.equal(channel.nacked.length, 1);
  assert.equal(channel.nacked[0].requeue, false);
});

test('handleOrderCreated logs the stubbed email/invoice action via the injected logger', () => {
  let logged = null;

  handleOrderCreated({ id: 7, totalCents: 500 }, (msg) => {
    logged = msg;
  });

  assert.match(logged, /order 7/);
  assert.match(logged, /500/);
});
