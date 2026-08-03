# ADR-012: Kafka via Strimzi, KRaft mode, and a Vault-sourced KafkaUser

- Status: accepted
- Date: 2026-08-03
- Author: data-engineer

## Context

Phase 6 batch 2 (`docs/phases.md`) requires Kafka as the immutable,
replayable event log for order-lifecycle events (`docs/vision.md`: "Kafka |
Immutable event log: order lifecycle events for many consumers"), a
distinct role from RabbitMQ's task queue (ADR-011) — `docs/architecture.md`:
"do not blur them". `docs/architecture.md` names the operator explicitly:
"Kafka via Strimzi operator second".

Two sub-decisions needed grounding:

### 1. ZooKeeper vs KRaft

Historically Strimzi supported both a ZooKeeper-backed `Kafka` CR and a
KRaft (`KafkaNodePool`-based) topology. Checking the current Strimzi
release (1.1.0, chart fetched live from https://strimzi.io/charts/ in this
session) against its own deploying guide
(https://strimzi.io/docs/operators/latest/deploying.html): "Kafka 4.0 runs
exclusively in KRaft mode, with no ZooKeeper integration. As a result of
this change, Strimzi removed support for ZooKeeper-based Kafka clusters
starting with version 0.46." This makes the choice moot for any Strimzi
version this lab could reasonably install — KRaft is the only option.

### 2. Where the `KafkaUser`'s password comes from

Every other credentialed service in this repo (Postgres, Redis, RabbitMQ)
sources its password from Vault via ESO — never from the service's own
generator. Strimzi's User Operator, by default, generates and owns a
random password in a Secret named after the `KafkaUser` CR
(`https://strimzi.io/docs/operators/latest/configuring.html`, "Managing
users" section — the User Operator "creates a new secret" when no password
source is given). Accepting that default would make Kafka the only service
in this lab whose credential does not originate in Vault.

Checked whether Strimzi's `KafkaUser` CR supports a pre-existing Secret
instead: confirmed, live in this session, against
`https://strimzi.io/docs/operators/latest/configuring.html` — a
`scram-sha-512` authentication's `password` field accepts a
`valueFrom.secretKeyRef` pointing at an existing Secret's key, and the User
Operator then reads (never overwrites) that Secret instead of generating
its own.

## Decision

1. Kafka runs in **KRaft mode**: one `KafkaNodePool` (`dual-role`:
   `controller` + `broker`) and one `Kafka` CR
   (`gitops/data/kafka/cluster.yaml`), mirroring Strimzi's own bundled
   single-node example
   (https://github.com/strimzi/strimzi-kafka-operator/blob/main/examples/kafka/kafka-single-node.yaml,
   fetched live in this session) in shape. No HA (`docs/vision.md`
   non-goal), matching ADR-007/ADR-011's posture for this ephemeral lab
   (ADR-004).
2. The `KafkaUser` "backend" (`gitops/data/kafka/user.yaml`) uses
   `authentication.type: scram-sha-512` with
   `password.valueFrom.secretKeyRef` pointing at `kafka-app-credentials` —
   a Secret populated ONLY by `gitops/data/kafka/externalsecret.yaml` from
   Vault kv-v2 path `secret/kafka` (written by
   `scripts/bootstrap-vault.sh`). Strimzi's User Operator never generates
   or mutates this Secret. This required brief was fully satisfiable — no
   fallback needed.

## Consequences

**Easier:** every credentialed service in this lab (Postgres, Redis,
RabbitMQ, Kafka) now follows the identical Vault -> ESO -> Secret ->
consuming-CR/Deployment flow, with no service-specific exception to
remember. Rotating the Kafka password only ever means rotating
`secret/kafka` in Vault, same operational muscle-memory as every other
service.

**Harder:** the `KafkaUser`'s username is fixed to its own
`metadata.name` (`backend`) by Strimzi's design — there is no username
override field, so `secret/kafka`'s `username` value is documentation-only
(mirrored in the KV entry for a human to cross-check, never read by
Strimzi), same trade-off already accepted for Postgres's
`bootstrap.initdb.owner` matching Vault's `username`. A future
multi-consumer KafkaUser (e.g. an Airflow reader in Phase 7) needs its own
CR name, its own Vault KV entry, and its own ExternalSecret — this does not
compose automatically, but each addition follows the exact same recipe.

**Accepted trade-off:** the internal listener is plaintext (`tls: false`)
with SASL/SCRAM-SHA-512 authentication only — passwords are never sent in
the clear (SCRAM is challenge-response), but data in transit is
unencrypted, consistent with every other in-cluster service in this lab
trusting the cluster network boundary instead of adding TLS.

**Also harder (startup ordering):** because the `KafkaUser` CR (wave "3")
is what actually registers the backend's SCRAM credentials with the
broker, and the backend's Kafka producer connects unconditionally (and
non-retriably on auth failure) at process startup, backend cannot safely
share the Kafka broker's own sync wave ("2") — it would race the
`KafkaUser` and, on a fresh sync, crash-loop before that CR ever gets a
chance to sync (Argo CD gates wave N+1 on wave N's health). Mitigated by
moving `gitops/services/backend/deployment.yaml` to wave "4", after the
`KafkaUser` (see that file's comment for the full reasoning). This is a
one-off exception to services otherwise sharing wave "2"; a future
service authenticating to Kafka at startup needs the same treatment.
