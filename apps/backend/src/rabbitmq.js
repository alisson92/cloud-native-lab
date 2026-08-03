// RabbitMQ publisher: order-created task-queue producer. Config comes
// entirely from env vars fed by External Secrets in gitops/ — never
// hardcoded here. Same pattern as db.js/redis.js.
//
// RabbitMQ here is a TASK QUEUE (docs/vision.md: "RabbitMQ | Task queue:
// order created -> worker sends email/invoice"), distinct from Kafka's
// immutable event log role (docs/architecture.md). A durable queue with a
// persistent message is the right shape for "this work must happen once",
// not "replay this fact for many consumers" — that is Kafka's job, out of
// scope for this module.
//
// API grounded in amqplib's own README (https://github.com/amqp-node/amqplib,
// promise-based API: connect, createChannel, assertQueue, sendToQueue).
'use strict';

const amqplib = require('amqplib');

// Queue name shared by convention with apps/worker/src/rabbitmq.js — no
// shared package between the two independently deployable services
// (docs/architecture.md's repository layout keeps apps/ per-service), so
// the name is duplicated by design, same as e.g. POSTGRES_DB being
// duplicated as a literal in both cluster.yaml and deployment.yaml.
const ORDER_CREATED_QUEUE = 'orders.created';

function buildConnectionUrl() {
  const host = process.env.RABBITMQ_HOST;
  const port = process.env.RABBITMQ_PORT || 5672;
  const user = encodeURIComponent(process.env.RABBITMQ_USER || '');
  const pass = encodeURIComponent(process.env.RABBITMQ_PASSWORD || '');
  return `amqp://${user}:${pass}@${host}:${port}`;
}

// Connects and opens a single Channel, reused for every publish for the
// life of the process — amqplib's own README recommends one Channel per
// logical unit of work rather than opening one per publish.
async function createRabbitMQChannel() {
  const connection = await amqplib.connect(buildConnectionUrl());
  const channel = await connection.createChannel();
  // durable: true — the queue itself survives a broker restart (its
  // definition, not necessarily unconsumed messages without a mounted
  // volume; see docs/adr/011-rabbitmq-plain-deployment.md for the
  // no-PVC trade-off accepted in this lab).
  await channel.assertQueue(ORDER_CREATED_QUEUE, { durable: true });
  return channel;
}

// Publishes an order-created message. `persistent: true` asks the broker
// to mark the message for disk write (amqplib README, Channel#sendToQueue
// options.persistent) so it isn't dropped from RabbitMQ's own in-memory
// queue state on a graceful restart — best-effort given no PVC is mounted
// (docs/adr/011), but strictly better than the default transient message.
function publishOrderCreated(channel, order) {
  const payload = Buffer.from(JSON.stringify(order));
  return channel.sendToQueue(ORDER_CREATED_QUEUE, payload, { persistent: true });
}

module.exports = { createRabbitMQChannel, publishOrderCreated, ORDER_CREATED_QUEUE };
