// Worker entrypoint: consumes "orders.created" messages published by the
// backend (docs/vision.md: "RabbitMQ | Task queue: order created -> worker
// sends email/invoice"). No HTTP server, no Express — plain Node.js
// process, same shape as the Phase 5 placeholder it replaces.
'use strict';

const fs = require('node:fs');
const { createRabbitMQChannel, startConsumer } = require('./rabbitmq');

const READY_FILE = '/tmp/ready';

async function main() {
  const channel = await createRabbitMQChannel();
  await startConsumer(channel);

  // Marker file for the exec-based readinessProbe (`cat /tmp/ready`,
  // gitops/services/worker/deployment.yaml), mirroring the pattern in
  // gitops/secrets-demo/deployment.yaml. Written only after the RabbitMQ
  // connection/consumer is actually up, so readiness reflects the
  // consumer's real ability to do its job, not just process startup.
  fs.writeFileSync(READY_FILE, '');
  console.log('worker: consuming orders.created from RabbitMQ');
}

main().catch((err) => {
  console.error('worker failed to start', err);
  process.exit(1);
});
