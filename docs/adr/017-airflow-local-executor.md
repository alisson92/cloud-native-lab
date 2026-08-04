# ADR-017: LocalExecutor for Airflow

- Status: accepted
- Date: 2026-08-03
- Author: platform-engineer

## Context

Phase 7 (`docs/phases.md`) needs Airflow running a single nightly DAG
(`sales_report`) on a single-node Kind cluster (`local/kind/kind-config.yaml`:
one control-plane node only) with a shared host budget already committed to
Phases 1-6's workloads (~3GiB used before this phase, host: 5 CPU /
15.6GiB per the task brief).

The official Helm chart (`airflow.apache.org`, chart 1.22.0) supports
`CeleryExecutor` (default), `KubernetesExecutor`, `LocalExecutor`, and
hybrid variants. `CeleryExecutor` requires a message broker (the chart's
own `redis` subchart) and one or more `workers` Deployments/StatefulSets —
a second messaging system on top of RabbitMQ/Kafka already in this lab,
for a workload that never needs more than one task running at a time.
`KubernetesExecutor` launches a new Pod per task and needs
`allowPodLaunching`/extra RBAC — more moving parts and slower single-task
startup than this DAG's simple, low-concurrency two-task graph justifies.

`LocalExecutor` runs tasks as subprocesses of the scheduler itself — no
broker, no extra worker component, no extra RBAC. This DAG never needs
more than 2 tasks running at once (`sales_report`'s two independent
tasks, `gitops/data/airflow/dags-configmap.yaml`), well within a single
scheduler process's capacity.

## Decision

`executor: "LocalExecutor"` (`gitops/apps/airflow.yaml`). The chart's
`postgresql`/`redis`/`statsd` subcharts and the `triggerer` component are
all disabled alongside it (docs/adr/018 covers `postgresql` specifically;
`redis`/`statsd` have no LocalExecutor use; `triggerer` only backs
deferrable operators, which this DAG does not use, per
https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/deferring.html).

## Consequences

**Easier:** fewer Deployments/StatefulSets on a resource-constrained
single-node host; no broker credentialing to add to
`scripts/bootstrap-vault.sh`; simpler mental model (docs/conventions.md:
"simplest thing that works").

**Harder:** no horizontal task parallelism beyond the scheduler's own
process/CPU limits, and a scheduler restart briefly stops all task
execution (no separate, independently-restartable worker pool). Both
acceptable for one nightly, two-task DAG.

**Accepted trade-off:** if this lab ever needs more concurrent DAGs or
tasks than one scheduler process can reasonably run, `CeleryExecutor` or
`KubernetesExecutor` become the right re-evaluation, not a speculative
default now.
