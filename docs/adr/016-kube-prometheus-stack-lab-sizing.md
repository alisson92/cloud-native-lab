# ADR-016: kube-prometheus-stack sizing and Alertmanager for this lab

- Status: accepted
- Date: 2026-08-03
- Author: platform-engineer

## Context

Phase 7 (`docs/phases.md`) requires observability via kube-prometheus-stack,
exit gate "dashboards are live", running on the local Kind cluster (ADR-004
— no GCP resources for this phase). The chart deploys Prometheus, the
Prometheus Operator, Alertmanager, Grafana, kube-state-metrics, and
node-exporter, each with a default of `resources: {}` (no limits at all,
confirmed via `helm pull prometheus-community/kube-prometheus-stack --untar`
in this session).

Kind here is single-node (`local/kind/kind-config.yaml`: control-plane only,
no worker nodes) on a 5 CPU / 15.6GiB host (Docker/WSL2 backend), already
running Vault, ESO, CloudNativePG, Redis, RabbitMQ, Kafka/Strimzi, and the
four application-tier services — with Airflow (the other half of Phase 7)
landing on the same host in parallel. This is a hard, measured constraint,
not a hypothetical one, so both "which components to run" and "how big"
needed an explicit decision instead of accepting every chart default.

Alternatives considered for Alertmanager specifically:
1. **Keep the chart default (`alertmanager.enabled: true`)**. Nothing in
   this lab configures an Alertmanager receiver/route (no email, Slack, or
   webhook target exists anywhere in the repo) — a running Alertmanager
   with no destination is speculative complexity with no consumer,
   `docs/conventions.md`'s exact "no speculative abstraction" case.
2. **Disable it (`alertmanager.enabled: false`)**. Prometheus + Grafana +
   kube-state-metrics + node-exporter alone already satisfy the exit gate
   ("dashboards are live") and represent one clear, stated need each
   (metrics collection, visualization, cluster/node metrics sources).

## Decision

- `alertmanager.enabled: false` — no configured alert sink exists in this
  lab; add it back only if/when a real receiver is introduced.
- `prometheus.prometheusSpec.retention: 24h` (chart default: `10d`) — this
  cluster is ephemeral and routinely destroyed/recreated
  (`docs/adr/004-local-first-validation-with-kind.md`), so multi-day
  retention has no consumer; a short window keeps the TSDB's on-disk
  footprint small.
- No `storageSpec` on Prometheus and no `persistence` on Grafana — both
  keep their state on the pod's default `emptyDir`, matching the "no PVC
  for ephemeral/non-source-of-truth data" trade-off already accepted for
  Redis (ADR-007) and RabbitMQ (ADR-011). Metrics history and Grafana's own
  dashboard-provisioning state are disposable; the chart re-provisions its
  default dashboards from ConfigMaps on restart either way.
- Single replica everywhere (`prometheus.prometheusSpec.replicas: 1`,
  `grafana.replicas: 1` — both already the chart default, set explicitly
  for readability): the single-node Kind host cannot usefully schedule a
  second replica of anything.
- Explicit `resources.requests`/`resources.limits` on every component kept
  (`prometheusOperator`, `prometheus.prometheusSpec`, `grafana`,
  `kube-state-metrics`, `prometheus-node-exporter`), replacing the chart's
  own unset defaults, per `docs/conventions.md`'s mandatory
  requests/limits rule and this host's real memory ceiling.

## Consequences

**Easier:** the stack fits comfortably alongside the rest of Phase 1-6's
workloads and the parallel Airflow deployment on one 15.6GiB host; the exit
gate ("dashboards are live") is met entirely by the chart's bundled default
Grafana dashboards, no custom dashboard authoring needed.

**Harder:** no alerting exists yet in this lab — if a future phase adds a
real notification target (email, Slack, PagerDuty, etc.), Alertmanager must
be re-enabled and configured at that point, not before.

**Accepted gap:** 24h retention means Prometheus data does not survive
much beyond a day, and neither Prometheus nor Grafana's own state survives
a pod restart (no PVC). Both are the correct trade-off for this lab's
ephemeral, cost-guarded scope (`docs/vision.md`) — dashboards render from
live cluster state and the chart's default provisioning either way. A
follow-up note for the reviewer/human: the application tier (backend, BFF,
frontend, worker) has no `/metrics` endpoint or ServiceMonitor today, so
Prometheus currently has no application-level signal to scrape — only
cluster/node/kube-state-metrics data. Adding app instrumentation is
explicitly out of scope for this task and left as a follow-up.
