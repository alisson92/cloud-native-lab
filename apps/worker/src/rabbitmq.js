// RabbitMQ consumer: order-created task-queue consumer. Config comes
// entirely from env vars fed by External Secrets in gitops/ — never
// hardcoded here. Same pattern as apps/backend/src/rabbitmq.js's producer
// side (queue name duplicated by design — see that file's comment).
//
// RabbitMQ here is a TASK QUEUE (docs/vision.md: "RabbitMQ | Task queue:
// order created -> worker sends email/invoice"): this consumer picks up
// one order-created message, does the (stubbed) email/invoice work, and
// acknowledges it so the broker removes it — a fact is processed once and
// discarded, unlike Kafka's replayable log (out of scope here).
//
// API grounded in amqplib's own README (https://github.com/amqp-node/amqplib,
// promise-based API: connect, createChannel, assertQueue, consume, ack).
'use strict';

const amqplib = require('amqplib');

const ORDER_CREATED_QUEUE = 'orders.created';

function buildConnectionUrl() {
  const host = process.env.RABBITMQ_HOST;
  const port = process.env.RABBITMQ_PORT || 5672;
  const user = encodeURIComponent(process.env.RABBITMQ_USER || '');
  const pass = encodeURIComponent(process.env.RABBITMQ_PASSWORD || '');
  return `amqp://${user}:${pass}@${host}:${port}`;
}

async function createRabbitMQChannel() {
  const connection = await amqplib.connect(buildConnectionUrl());
  const channel = await connection.createChannel();
  // Same durable declaration as the backend's producer — assertQueue is
  // idempotent (amqplib README: declares only if the queue doesn't already
  // exist), so whichever of backend/worker starts first creates it.
  await channel.assertQueue(ORDER_CREATED_QUEUE, { durable: true });
  return channel;
}

// Stubbed email/invoice handler: this lab does not send real email or
// render real invoices (docs/vision.md's non-goals: "Feature-rich
// applications: app code is intentionally minimal"). Logging what would
// happen is enough to prove the consumer side of the task queue works.
function handleOrderCreated(order, log = console.log) {
  log(`order ${order.id}: sending email + invoice (stub) — total ${order.totalCents} cents`);
}

// Consumes messages one at a time (no prefetch tuning needed at this lab's
// traffic volume) and manually acks each one after the handler runs, so a
// handler throwing leaves the message unacked/requeued rather than lost —
// amqplib README: Channel#consume with noAck defaulting to false requires
// an explicit Channel#ack.
function startConsumer(channel, onMessage = handleOrderCreated) {
  return channel.consume(ORDER_CREATED_QUEUE, (msg) => {
    if (!msg) return; // amqplib delivers null if the consumer is cancelled server-side.
    try {
      const order = JSON.parse(msg.content.toString());
      onMessage(order);
      channel.ack(msg);
    } catch (err) {
      console.error('failed to process order-created message', err);
      // requeue=false: a message that fails to parse/process will never
      // succeed on blind retry in this lab (no dead-letter exchange
      // configured); avoid a poison-message infinite redelivery loop.
      channel.nack(msg, false, false);
    }
  });
}

module.exports = { createRabbitMQChannel, startConsumer, handleOrderCreated, ORDER_CREATED_QUEUE };
