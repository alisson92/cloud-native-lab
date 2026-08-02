'use strict';

const HEARTBEAT_MESSAGE =
  'Placeholder worker running — RabbitMQ consumer arrives in Phase 6 (see docs/phases.md)';

function heartbeat(log = console.log) {
  log(HEARTBEAT_MESSAGE);
}

module.exports = { heartbeat, HEARTBEAT_MESSAGE };
