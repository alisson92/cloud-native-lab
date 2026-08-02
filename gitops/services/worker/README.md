# Worker

Phase 5 placeholder (`docs/phases.md`): this is a scaffold, not the final
worker. `apps/worker/src/index.js` writes `/tmp/ready` on startup and runs a
heartbeat loop — no RabbitMQ consumer, no email/invoice logic, no HTTP
server.

Phase 6 (`docs/phases.md`) replaces this heartbeat loop with the actual
RabbitMQ consumer (`docs/vision.md`: "RabbitMQ | Task queue: order created ->
worker sends email/invoice"). Do not add RabbitMQ logic, credentials, or
wiring to this directory yet — that is Phase 6's scope, owned by
data-engineer, and belongs in its own reviewed batch.
