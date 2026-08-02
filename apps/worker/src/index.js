// Scaffold only: Phase 6 wires an actual RabbitMQ consumer here (see
// docs/phases.md). No HTTP server, no Express — plain Node.js process.
'use strict';

const fs = require('node:fs');
const { heartbeat } = require('./heartbeat');

const READY_FILE = '/tmp/ready';
const HEARTBEAT_INTERVAL_MS = 10_000;

// Marker file for a later exec-based readinessProbe (`test -f /tmp/ready`),
// mirroring the pattern in gitops/secrets-demo/deployment.yaml.
fs.writeFileSync(READY_FILE, '');

heartbeat();
setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
