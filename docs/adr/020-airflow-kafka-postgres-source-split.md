# ADR-020: Kafka/Postgres responsibility split in the sales-report DAG

- Status: accepted
- Date: 2026-08-03
- Author: platform-engineer

## Context

`docs/vision.md`'s Airflow row says it aggregates "events" into sales
reports, and this repo's own precedent
(`docs/adr/015-kafka-gate-verifier-user.md`'s Consequences) commits Phase
7 to giving Airflow a real Kafka consumer, not just a Postgres reader.
Both systems can, in principle, answer "what orders happened":

- Postgres (`orders`/`products` tables, `apps/backend/src/db.js`) is the
  transactional system of record, with a `created_at` timestamp Kafka's
  payload does NOT carry (`apps/backend/src/kafka.js`: `{ type:
  'order.created', order: { id, productId, quantity, totalCents } }` — no
  timestamp field).
- Kafka (`order-events` topic) is the replayable event log, consumed
  independently by any number of readers (docs/architecture.md's
  integration map), but on its own cannot answer "which day did this
  happen" for a dated report.

A DAG that used only one of the two would make the other's `KafkaUser`
(`gitops/data/kafka/airflow-user.yaml`) or its Postgres connection dead
weight — against docs/conventions.md ("Delete code and config that is not
used").

## Decision

`gitops/data/airflow/dags-configmap.yaml`'s `sales_report` DAG has two
INDEPENDENT tasks, not one pipeline chaining Kafka into Postgres or vice
versa:

- `aggregate_daily_sales` — the actual dated report (`sales_reports`
  table: product, order count, revenue), computed from Postgres alone,
  because only Postgres has the data (`created_at`) that a report needs.
- `consume_order_events` — replays `order-events` via
  `ConsumeFromTopicOperator` and records how many events this run consumed
  into `kafka_event_counts`, proving the event log is genuinely read by a
  long-lived consumer (not just CLI-verified, per ADR-015's own
  accepted-trade-off note).

Both write into the SAME "orders" Postgres database (reused as report
storage, ADR-019) but into separate tables, with no task dependency edge
between them.

## Consequences

**Easier:** each task's correctness is independently verifiable
(`gitops/data/airflow/README.md`'s exit-gate `psql` queries check two
tables, not one merged one); a Kafka outage cannot block the dated
Postgres report from landing, and vice versa.

**Harder:** the two tables are not joined or reconciled against each
other — `kafka_event_counts` cannot be used to validate
`sales_reports`' completeness. Acceptable for this lab: the point of
consuming Kafka here is provenance ("this consumer is real"), not a second
source of truth for the report's numbers.

**Accepted trade-off:** Airflow reuses the existing "orders" application
Postgres credential (`secret/postgres` in Vault) for its read query,
rather than a new dedicated read-only Postgres role
(`gitops/data/airflow/secretstore.yaml`'s header comment) — the simplest
option available given this lab has no existing read-only-role convention
to extend, not a security best-practice default; a real production system
would scope this tighter.
