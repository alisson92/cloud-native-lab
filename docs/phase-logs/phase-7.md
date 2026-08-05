# Phase 7 — Operations

Owner: platform-engineer. Exit gate (docs/phases.md): a nightly DAG run
produces a report; dashboards are live, verified on Kind. Documentation
(README + diagrams) was a non-gating parallel deliverable.

## Summary

- Batch 1 (PR #36, ADR-016): kube-prometheus-stack via GitOps — chart
  88.1.3, Prometheus + Grafana + kube-state-metrics + node-exporter kept
  (default dashboards satisfy "dashboards live"), Alertmanager disabled
  (no configured receiver), retention trimmed to 24h, no PVC.
- Batch 1 (PR #38, ADR-017..020): Airflow via GitOps — chart 1.22.0
  (Airflow 3.2.2), `LocalExecutor`, nightly `sales_report` DAG (Postgres
  aggregate + Kafka event-count cross-check, ConfigMap-delivered — ADR-018).
  Metadata DB: new `Database`/role on the existing CloudNativePG cluster,
  not a second instance (ADR-019). New read-only `airflow` `KafkaUser`
  replacing `gate-verifier` (ADR-015's own anticipated follow-up).
- Batch 1 (PR #37, non-gating): root `README.md` + `docs/order-flow.md`,
  grounded in Phase 1-6 shipped state only.
- Tooling (PR #39, ADR-013 extended): `bump-gitops` automation added to
  `airflow-ci.yml` for the nested Helm `images.airflow.tag` field —
  the per-service `sed` pattern doesn't apply to a Helm `valuesObject`,
  so this job matches on the `tag: "..."` line instead.
- Reviewer verdict on the original batch: **CHANGES REQUESTED** (missing
  resource limits on 2 sidecar/log-groomer containers, a stale runbook
  reference to the removed `gate-verifier` KafkaUser) — both fixed in the
  same PRs before merge, then re-reviewed clean.

## Live-only bugs found and fixed post-merge

None of these were catchable pre-merge — sync-wave deadlocks, resource
limits, and an Airflow 3 API behavior change only surface once Argo CD,
Vault, and the actual Helm chart run for real on Kind:

1. **Vault dev-mode state loss** (same failure mode as Phases 3/5/6):
   `vault-0` restarted, wiping the Kubernetes auth method. Fixed by
   re-running `scripts/bootstrap-vault.sh` — which itself hit a latent
   bug fixed in the same pass: `grep -m1` piped from a large `kubectl
   logs` output caused a SIGPIPE/`pipefail` failure once the pod's log
   grew past ~1400 lines (deterministic once the match landed early in a
   large stream); replaced with plain `grep` + `head -1` so the upstream
   process reaches EOF before either process writes.
2. **ServiceAccount sync-wave gap** (PR #40): `migrateDatabaseJob`/
   `createUserJob`'s `jobAnnotations` sync-wave only annotated the Job,
   not the chart-created ServiceAccount (defaulted to wave "0", later
   than the Job's wave "-2"/"-1") — the Job could never find its own
   ServiceAccount. Fixed via the chart's `serviceAccount.annotations`
   field, matched to each Job's wave.
3. **`airflow-config` ConfigMap sync-wave gap** (PR #43): same deadlock
   class, different dependency — the chart's own `airflow-config`
   ConfigMap (default wave "0") is mounted by both Jobs, later than
   `migrateDatabaseJob`'s wave "-2". Fixed via `airflowConfigAnnotations`.
   A holistic re-check of every volume/secretKeyRef/ServiceAccount on
   both Jobs' pod specs at this point still missed one dependency (next).
4. **Image tag never bumped** (PR #44): the image was built and pushed by
   `airflow-ci`'s `push` job on PR #38's own merge commit, but the
   `bump-gitops` job (PR #39) didn't exist yet at that point — no
   automated PR ever fired. One-time manual catch-up to the real,
   already-pushed SHA (confirmed present in `ghcr.io` via `docker
   manifest inspect`); every future `apps/airflow/**` change bumps it
   automatically from here on.
5. **`airflow-api-secret-key`/`airflow-jwt-secret` sync-wave gap**
   (PR #45): the "holistic check" in fix #3 missed that the chart's
   auto-generated API secret is a plain `Sync/0` resource, not a PreSync
   hook — `migrateDatabaseJob` sets `AIRFLOW__API__SECRET_KEY` from it.
   Fixed via `apiSecretAnnotations`/`jwtSecretAnnotations`, both matched
   to wave "-2" (the JWT secret bumped pre-emptively once `helm template`
   confirmed the api-server/scheduler containers also need it).
6. **`createUserJob` OOMKilled** (PR #46): `airflow users create` (the
   full FAB auth-manager CLI) exceeded the original 128Mi limit — bumped
   to match `migrateDatabaseJob`'s already-working 256Mi rather than
   tuning a second value by trial and error.
7. **Scheduler OOMKilled** (PR #47): `airflow-scheduler-0` OOMKilled
   twice at the original 512Mi limit. `LocalExecutor` (ADR-017) runs
   every DAG task as a subprocess of this same container, on top of DAG
   parsing and the scheduler loop — real footprint is higher than a
   scheduler-only pod. Doubled to 1Gi/512Mi.
8. **`aggregate_daily_sales() missing 1 required positional argument:
   'ds'`** (PR #48): `PythonOperator` does not auto-inject context
   variables into the callable by signature-name matching in this chart
   version — first fix added `op_kwargs={"ds": "{{ ds }}"}`.
9. **`UndefinedError: 'ds' is undefined`** (PR #49): PR #48's fix was
   itself incomplete — Jinja-rendering `{{ ds }}` fails whenever a run
   has no `logical_date`, which happens for `airflow dags trigger`
   without an explicit date (not only for asset-triggered DAGs, per the
   official templates-ref docs). The real nightly schedule always has a
   `logical_date`, but this blocked live verification and was a latent
   bug for any future manual re-run. Fixed by deriving `report_date` from
   `context["dag_run"].logical_date` with a `pendulum.now()` fallback —
   correct for both trigger types.
10. **Grafana sidecars OOMKilled** (PR #41, found alongside the Airflow
    chain): `grafana-sc-dashboard`/`grafana-sc-datasources` restarted
    172+ times at the 64Mi limit set during PR #36's own review-fix
    round. Bumped to 128Mi/256Mi, grounded in `kiwigrid/k8s-sidecar`
    issue #462's reported ~189Mi steady-state on the pinned 2.10.0 line.

Two subresource operational quirks encountered along the way, not code
bugs: Argo CD's automated-sync operations cache the Helm-rendered
manifest at operation start and don't pick up a newer `git` commit's
`valuesObject` mid-retry — each fix above required `argocd app
terminate-op` + a fresh `sync` (sometimes after `root-app` itself caught
up to the latest commit first). And `subPath`-mounted ConfigMap volumes
(the DAG file) don't live-update via kubelet — `kubectl rollout restart`
on the scheduler/dag-processor was needed after each DAG code change.

## Exit gate verification (human + orchestrator, live on Kind)

```
$ kubectl get applications -n argocd
NAME                     SYNC STATUS   HEALTH STATUS
airflow                  Synced        Healthy
cloudnativepg-operator   Synced        Healthy
external-secrets         Synced        Healthy
kube-prometheus-stack    Synced        Healthy
root-app                 Synced        Healthy
strimzi                  Synced        Healthy
vault                    Synced        Healthy
```

- **Nightly DAG produces a report**: `sales_report` ran successfully both
  via its real cron schedule (`0 2 * * *`, run_id
  `scheduled__2026-08-04T02:00:00+00:00`) and via a manual
  `airflow dags trigger` used to verify without waiting for 02:00 UTC.
  `orders` database, table `sales_reports`: real per-product
  revenue/order-count rows (Coffee Mug, Notebook, Sticker Pack). Table
  `kafka_event_counts`: confirms the Kafka side of the DAG actually
  consumed `order-events` (2 messages on the scheduled run).
- **Dashboards are live**: Grafana `3/3 Running`, 0 restarts. 28
  dashboards loaded (`GET /api/search`), Prometheus datasource returning
  real scrape data (`up{}` query: `kube-state-metrics=1`, `kubelet=1`,
  16 active series).

## Key decisions

- ADR-016: kube-prometheus-stack sizing for the single-node Kind host
  (Alertmanager disabled, 24h retention, no PVC).
- ADR-017: Airflow `LocalExecutor` (no Celery/Redis broker).
- ADR-018: DAG delivered via a Git-versioned ConfigMap, not `dags.gitSync`.
- ADR-019: Airflow metadata DB reuses the existing CloudNativePG cluster.
- ADR-020: DAG reads both Postgres (dated aggregate) and Kafka
  (event-log cross-check) — deliberately not chained into one pipeline.
- ADR-013 (extended): `bump-gitops` automation for a nested Helm
  `valuesObject` field, not just a flat `image:` line.
- ADR-021: Airflow base image switched to `apache/airflow:slim-3.2.2`
  (the default image's Google/Amazon provider extras pulled unrelated
  CVEs via `litellm`/`ray`, unused by this DAG).
