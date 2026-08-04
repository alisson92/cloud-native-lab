# ADR-019: Airflow metadata DB reuses the existing CloudNativePG Cluster

- Status: accepted
- Date: 2026-08-03
- Author: platform-engineer

## Context

Airflow needs its own metadata database (Airflow's own connection-string
scheme: `postgresql+psycopg2://user:pass@host/db`,
`https://raw.githubusercontent.com/apache/airflow/helm-chart/1.22.0/chart/values.yaml`,
`data.metadataConnection`/`data.metadataSecretName`). The chart's default
is to deploy its own bundled Postgres via a Bitnami subchart
(`postgresql.enabled: true`).

This lab's single-node Kind host (`local/kind/kind-config.yaml`) has no
spare capacity for a whole second Postgres instance on top of the existing
CloudNativePG "orders" `Cluster` (`gitops/data/postgres/cluster.yaml`,
Phase 4) — every additional StatefulSet/Deployment competes for the same
~5 CPU / 15.6GiB host, already carrying Phases 1-6's workloads plus this
phase's own Airflow scheduler/api-server/dag-processor pods (this task's
own brief flags this constraint explicitly). It would also duplicate an
operator's worth of PVC-backed storage, backup/restore surface, and
credentialing for a database with zero traffic beyond Airflow's own
internal bookkeeping.

CloudNativePG's declarative database/role management
(`https://cloudnative-pg.io/docs/1.27/declarative_database_management/`,
`https://cloudnative-pg.io/docs/1.27/declarative_role_management/`) lets a
single `Cluster` host multiple logically-isolated databases, each with its
own owning role — "CloudNativePG manages global objects... such as
databases, roles... but does not manage the content of databases", which
is exactly the isolation level Airflow's metadata DB needs from the
"orders" application database it now shares an instance with (separate
database, separate role, no cross-database access by default in
PostgreSQL).

This trade-off was confirmed with the human operator before implementation
(per this task's brief).

## Decision

`gitops/data/postgres/cluster.yaml`'s existing `Cluster` "postgres" gains:
- a new managed role `airflow` (`spec.managed.roles`), password from Vault
  path `secret/airflow` via `airflow-role-externalsecret.yaml`;
- a new `Database` CR `airflow-database.yaml` (`spec.owner: airflow`,
  `spec.cluster.name: postgres`).

`gitops/apps/airflow.yaml` disables the chart's bundled `postgresql`
subchart and points `data.metadataSecretName` at a Secret
(`gitops/data/airflow/externalsecret-metadata-db.yaml`) built from that
same `secret/airflow` Vault path.

## Consequences

**Easier:** no second Postgres instance's CPU/memory/storage footprint;
one operator (CloudNativePG) already trusted and understood
(`docs/adr/008-postgres-operator-proportionality.md`) manages both
databases; one existing backup/restore story (out of this lab's scope
either way) instead of two.

**Harder:** the "orders" `Cluster`'s availability now gates BOTH the
order-placement application AND Airflow — a Postgres outage takes down
two phases' exit gates at once, not one. Acceptable for a single-node,
ephemeral lab (`docs/adr/004-local-first-validation-with-kind.md`); would
need re-evaluating for a real production separation of concerns.

**Accepted trade-off:** `postgres`'s own Vault policy (`postgres-read` in
`scripts/bootstrap-vault.sh`) now also reads `secret/data/airflow` — a
small, explicit widening of that namespace's SecretStore scope, required
by CloudNativePG's own colocation rule (`passwordSecret` must live in the
Cluster's namespace), not an accidental broadening.
