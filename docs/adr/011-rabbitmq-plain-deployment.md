# ADR-011: RabbitMQ as a plain Deployment, not an operator

- Status: accepted
- Date: 2026-08-02
- Author: data-engineer

## Context

Phase 6 (`docs/phases.md`) requires RabbitMQ as the task queue that hands
"order created" work from the backend to the worker (email/invoice),
`docs/vision.md`. `docs/architecture.md` names it "RabbitMQ (task queue)
first" in Phase 6, with no operator mandated.

Alternatives considered:

1. **The RabbitMQ Cluster Kubernetes Operator** (official, CNCF-adjacent
   project maintained by Broadcom/VMware). It manages multi-node RabbitMQ
   clusters, quorum queues, TLS, and upgrades — the kind of complexity that
   earns its keep when a queue needs HA/clustering. This lab needs one
   broker instance handling one lightweight message type
   (`docs/vision.md`'s non-goals explicitly exclude "High availability and
   multi-region setups"). An operator would add a CRD, a controller, and an
   extra reconciliation loop for a single-pod workload — the same
   "speculative abstraction" ADR-007 rejected for Redis.
2. **A plain Deployment + Service**, credentials wired from Vault via ESO
   (this repo's standard pattern since Phase 3). RabbitMQ's own official
   Docker image documentation (hub.docker.com/_/rabbitmq) documents running
   the broker via a single `docker run`/container with
   `RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS` env vars for bootstrap
   credentials — a single-container deployment is the tool's own documented
   baseline for this workload shape, exactly like ADR-007 found for Redis.
   RabbitMQ's Kubernetes monitoring guidance
   (https://www.rabbitmq.com/docs/monitoring) also documents the readiness
   probe shape (`tcpSocket` on the AMQP port) independently of whether the
   Operator is used, so no operator-specific capability is lost here.

## Decision

RabbitMQ runs as a plain Kubernetes `Deployment`
(`gitops/data/rabbitmq/deployment.yaml`) with 1 replica and a matching
`Service` (`gitops/data/rabbitmq/service.yaml`), default-user credentials
sourced from Vault via ESO. No PersistentVolumeClaim: unconsumed queue
messages are transient work items (order-created notifications), not the
durable/replayable record — that role belongs to Kafka
(`docs/architecture.md`: "Kafka is an immutable event log"). Losing an
unconsumed message on a pod restart in this ephemeral Kind lab
(`docs/adr/004-local-first-validation-with-kind.md`) is an accepted
trade-off, matching ADR-007's Redis posture.

## Consequences

**Easier:** no extra CRDs or controller to reconcile for a single-pod task
queue; the manifest is readable end-to-end by a junior engineer in one pass
(`docs/conventions.md`); matches the credential-flow and manifest-shape
pattern already established for Postgres/Redis (Vault -> ESO -> Secret ->
Deployment), so no new mental model is introduced.

**Harder:** if a future phase needs RabbitMQ clustering, quorum queues, or
zero-message-loss guarantees across broker restarts, this Deployment must
be replaced, likely by adopting the official RabbitMQ Cluster Kubernetes
Operator, which manages exactly that lifecycle.

**Accepted trade-off:** an unconsumed message is lost if the RabbitMQ pod
restarts before the worker acknowledges it. Acceptable for a lab where the
downstream effect is a best-effort email/invoice notification, not a
financial or inventory-critical write (those live in PostgreSQL, already
committed before the message is published — see `apps/backend/src/
orders.js`).
