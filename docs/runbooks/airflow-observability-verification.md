# Runbook — Airflow nightly DAG + kube-prometheus-stack verification (Phase 7)

**Last updated:** 2026-08-04
**Author:** technical-writer (cloud-native-lab)
**Environment:** Kind Dev
**Estimated time:** 25 minutes
**Risk level:** Low

---

## Objective

This runbook validates Phase 7's exit gate (`docs/phases.md`: "Nightly DAG
produces a report; dashboards live") on the local Kind cluster: that the
`sales_report` Airflow DAG (`gitops/data/airflow/dags-configmap.yaml`) runs
successfully and writes real rows to Postgres, and that the
kube-prometheus-stack Grafana deployment (`gitops/apps/kube-prometheus-stack.yaml`)
is serving live dashboards backed by real scrape data — not just an empty
shell.

It is a different concern from `docs/runbooks/smoke-test.md`, which covers
the order-placement flow (frontend/BFF/backend/RabbitMQ/Kafka). This
runbook covers the two operational-tier components added in Phase 7:
Airflow (batch ETL) and observability.

This is mostly a read/verify exercise, plus one DAG trigger (writes rows to
the `orders` database's `sales_reports`/`kafka_event_counts` tables — normal
application data, safe to repeat).

Every step and every gotcha below was exercised live on the operator's Kind
cluster during Phase 7 verification (`TASKS.md`, Phase 7 entries); this
runbook exists so the next verification pass does not have to rediscover
the same issues.

---

## Prerequisites

- [ ] Docker (or the container runtime backing Kind) is running:
      `docker info` succeeds
- [ ] Kind cluster exists and is the current context:
      `kubectl config current-context` returns `kind-cloud-native-lab`
- [ ] `kubectl`, `curl`, `argocd` CLI, and `jq` (optional) are on `PATH`
- [ ] No other `kubectl port-forward` session is already using local port
      `3000`

---

## ⚠️ Points of attention

- **Vault comes back up sealed after every `vault-0` pod restart**
  (`docs/adr/022-vault-standalone-file-storage.md`, standalone mode with a
  persistent `file` backend — supersedes the dev-mode data loss
  `docs/adr/006-vault-dev-mode-for-lab.md` originally described for every
  phase). If in doubt, run `bash scripts/unseal-vault.sh` first (step 1) —
  it is idempotent, a no-op if Vault is already unsealed. Only fall back to
  `bash scripts/bootstrap-vault.sh` if Vault reports `initialized: false`
  (a genuinely fresh PVC).
- **Argo CD's automated-sync operations cache the rendered Helm manifest at
  operation start.** If a fix lands as a new commit while an `airflow` or
  `kube-prometheus-stack` Application sync is already retrying (e.g. stuck
  on a prior failure), the retry can keep re-applying the *old* rendered
  manifest and never pick up the new commit's `valuesObject`. See the
  recovery sequence in Troubleshooting below (`argocd app terminate-op`).
- **`subPath`-mounted ConfigMap volumes do not live-update via kubelet.**
  The DAG file (`gitops/data/airflow/dags-configmap.yaml`, mounted at
  `/opt/airflow/dags/sales_report_dag.py` via `subPath`) will NOT reflect a
  newer ConfigMap version in a running pod just because Argo CD synced it.
  After any DAG code change lands, restart the components that read it:
  `kubectl rollout restart statefulset/airflow-scheduler
  deployment/airflow-dag-processor -n airflow`. This is a safe, GitOps-
  compatible recovery action — it forces the pods to re-read the
  already-correct state from Git/the synced ConfigMap, it does not change
  desired state itself.
- **Kubernetes Jobs are immutable** (`spec.template` cannot be patched in
  place). If `airflow-run-airflow-migrations` or `airflow-create-user` is
  stuck with a stale pod template after a `gitops/apps/airflow.yaml` fix
  syncs, `kubectl delete job <name> -n airflow` lets Argo CD recreate it
  fresh on the next sync. Also a safe recovery action for the same reason:
  the Job spec Argo CD recreates it with is already the corrected one in
  Git.
- **DAGs are paused by default** on first creation — `airflow dags trigger`
  on a paused DAG queues the run but the scheduler will not execute it
  until unpaused.
- **There is no `airflow tasks logs` CLI subcommand** in this chart's
  Airflow version. Task logs must be read directly from the log files on
  disk (step 6 below).
- **Grafana's admin password is chart-generated, not the documented
  default.** `prom-operator` (the chart's README example) does NOT work
  here — fetch the real password from the chart-generated Secret (step 8).
- **The sales report lives in the `orders` database, not the `airflow`
  metadata database.** Both databases exist in the same shared CloudNativePG
  cluster (`docs/adr/019-airflow-metadata-db-shared-cluster.md`) — `psql -U
  postgres -l` shows both; the wrong one gives a `relation "sales_reports"
  does not exist` error, not empty results.

---

## Steps

### 1. Unseal Vault (safe to always run)

```bash
cd cloud-native-lab
bash scripts/unseal-vault.sh
```

**Expected result:** `==> Vault unsealed.` or `==> Vault is already
unsealed. Nothing to do.` If it errors because
`.vault-bootstrap-cache/vault-init.json` is missing, run the one-time init
instead: `bash scripts/bootstrap-vault.sh` (ends with `==> Done. Verify
with each directory's 'Verifying the exit gate' section.`).

---

### 2. Confirm the `airflow` and `kube-prometheus-stack` Argo CD Applications are healthy

```bash
for app in airflow kube-prometheus-stack; do
  echo "=== ${app} ==="
  kubectl -n argocd get application "${app}" \
    -o jsonpath='{.status.sync.status} {.status.health.status}{"\n"}'
done
```

**Expected result:** `Synced Healthy` for both. If either is stuck
`Progressing`/`Degraded` for more than a couple of minutes, see
Troubleshooting ("Argo CD Application stuck re-applying a stale rendered
manifest").

---

### 3. Confirm every `airflow` namespace `ExternalSecret` is synced

```bash
kubectl -n airflow get externalsecret
```

**Expected result:** all rows `STATUS: SecretSynced`, `READY: True`
(`airflow-metadata-db-credentials`, `airflow-postgres-connection`,
`airflow-kafka-connection`).

---

### 4. Confirm Airflow pods and Jobs are healthy

```bash
kubectl -n airflow get pod
```

**Expected result:** `airflow-scheduler-0`, `airflow-api-server-*`,
`airflow-dag-processor-*` all `Running`/`Ready`;
`airflow-run-airflow-migrations-*` and `airflow-create-user-*` Job pods
`Completed` (not `CrashLoopBackOff`/`OOMKilled` — see Troubleshooting if
so).

```bash
kubectl -n postgres get database airflow
kubectl -n kafka get kafkauser airflow
```

**Expected result:** both `STATUS: Ready True`.

---

### 5. Trigger the `sales_report` DAG and wait for it to finish

Airflow's LocalExecutor (`docs/adr/017-airflow-local-executor.md`) runs
tasks as subprocesses of the scheduler, so all `airflow` CLI operations
below run inside the `airflow-scheduler-0` pod's `scheduler` container.

```bash
# Confirm the DAG is registered and check whether it's paused.
kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- airflow dags list
```

**Expected result:** `sales_report` appears in the list.

```bash
# DAGs are paused on first creation (see Points of attention) — unpause
# once; a no-op if already unpaused.
kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- \
  airflow dags unpause sales_report

# Trigger a run rather than waiting for the real "0 2 * * *" schedule.
kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- \
  airflow dags trigger sales_report
```

**Expected result:** a line confirming the run was created, including its
`run_id` (format `manual__<timestamp>`). Note it for the next commands.

```bash
# Poll until state is success or failed (usually well under a minute for
# this DAG's two lightweight tasks).
kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- \
  airflow dags state sales_report "<run_id>"
```

**Expected result:** `success`. If `failed`, check per-task status and
logs next.

```bash
kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- \
  airflow tasks states-for-dag-run sales_report "<run_id>"
```

**Expected result:** both `aggregate_daily_sales` and
`consume_order_events` show `success`.

---

### 6. If a task failed: read its log directly

There is no `airflow tasks logs` CLI subcommand in this chart's Airflow
version (see Points of attention) — locate and read the log file instead:

```bash
kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- \
  find /opt/airflow/logs -iname "*<task_id>*"

kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- \
  cat "<path from previous command>/attempt=1.log"
```

---

### 7. Verify the report data landed in the `orders` database

The report is written by the DAG into the `orders` database (the
application database, not Airflow's own metadata database — see Points of
attention). Confirm both databases exist first if this is a fresh
investigation:

```bash
kubectl exec -n postgres postgres-1 -- psql -U postgres -l
```

**Expected result:** both `orders` and `airflow` databases listed.

```bash
kubectl exec -n postgres postgres-1 -- \
  psql -U postgres -d orders -c 'SELECT * FROM sales_reports ORDER BY id;'

kubectl exec -n postgres postgres-1 -- \
  psql -U postgres -d orders -c 'SELECT * FROM kafka_event_counts ORDER BY id;'
```

**Expected result:** `sales_reports` has one row set per product from this
run (full-history snapshot, not day-windowed — see the DAG's own docstring
in `gitops/data/airflow/dags-configmap.yaml` for why); `kafka_event_counts`
has at least one row for the triggered `run_id`, with `events_consumed`
reflecting however many `order-events` messages were pending in the
`airflow-sales-report` consumer group (may be `0` on a repeat run if a
prior consumer — including `docs/runbooks/smoke-test.md`'s step 7 — already
committed past every available message; that is expected, not a failure).

---

### 8. Verify Grafana dashboards are live

```bash
GRAFANA_USER=$(kubectl get secret -n monitoring kube-prometheus-stack-grafana \
  -o jsonpath='{.data.admin-user}' | base64 -d)
GRAFANA_PASSWORD=$(kubectl get secret -n monitoring kube-prometheus-stack-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d)

kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80 \
  >/tmp/grafana-pf.log 2>&1 &
sleep 3
```

**Expected result:** credentials are chart-generated — do NOT assume the
chart's documented default `prom-operator` works (it does not, see Points
of attention).

```bash
curl -s -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" http://localhost:3000/api/search
```

**Expected result:** a non-empty JSON array of dashboards (the chart's
bundled defaults — Kubernetes/node/cluster dashboards — satisfy "dashboards
live" without any custom authoring, per `gitops/apps/kube-prometheus-stack.yaml`).

```bash
curl -s -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" http://localhost:3000/api/datasources
```

**Expected result:** a `prometheus` datasource entry; note its `uid`.

```bash
curl -s -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
  "http://localhost:3000/api/datasources/proxy/uid/<uid>/api/v1/query?query=up"
```

**Expected result:** `"status":"success"` with a non-empty `result` array —
confirms Prometheus is actually scraping targets (Grafana is not just
rendering an empty datasource shell).

---

### 9. Cleanup

```bash
kill %1 2>/dev/null  # stops the port-forward started in step 8
```

**Success criterion (all of the above):**
- [ ] `airflow` and `kube-prometheus-stack` Applications `Synced`/`Healthy`
- [ ] Every `airflow` namespace `ExternalSecret` synced
- [ ] All Airflow pods `Running`; both Jobs `Completed`
- [ ] `sales_report` DAG run state `success`, both tasks `success`
- [ ] `sales_reports` and `kafka_event_counts` have rows in the `orders`
      database
- [ ] Grafana `/api/search` returns dashboards
- [ ] Grafana's Prometheus datasource proxy query (`up`) returns real
      scrape results

---

## Rollback

Not applicable — this runbook is non-destructive. The DAG run writes normal
application rows (`sales_reports`, `kafka_event_counts`) to the `orders`
database; there is nothing to revert.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `SecretSyncedError` on any `airflow` namespace `ExternalSecret`, `403 permission denied` in `external-secrets` logs | Vault is sealed after a `vault-0` pod restart | Run `bash scripts/unseal-vault.sh` (step 1) |
| `airflow` or `kube-prometheus-stack` Application stuck `Progressing`/`Degraded`, and a newer commit with the fix already exists in Git | Argo CD's automated-sync operation cached the rendered Helm manifest at operation start and is retrying against the stale render, not the newer commit | `argocd app terminate-op <app>` (retry/wait if it errors with "another operation is already in progress"), then confirm the live object has the expected value: `kubectl get application <app> -n argocd -o jsonpath='{.spec.source.helm.valuesObject}'`, then `argocd app sync <app> --prune`. If `root-app` itself is behind (`kubectl get application root-app -n argocd -o jsonpath='{.status.sync.revision}'` vs `git rev-parse origin/main`), sync `root-app` first |
| Newer DAG code (per `git log gitops/data/airflow/dags-configmap.yaml`) does not seem to run, even though the ConfigMap synced | `subPath`-mounted ConfigMap volumes don't live-update via kubelet | `kubectl rollout restart statefulset/airflow-scheduler deployment/airflow-dag-processor -n airflow` |
| `airflow-run-airflow-migrations` or `airflow-create-user` Job stuck with an outdated pod spec after a `gitops/apps/airflow.yaml` fix synced | Kubernetes Jobs are immutable (`spec.template` can't be patched); Argo CD can't reconcile the running Job's spec in place | `kubectl delete job <name> -n airflow` — Argo CD recreates it fresh from the already-correct Git state on the next sync |
| `airflow dags trigger` reports the run created, but it never executes | DAG is paused (default on first creation) | `kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- airflow dags unpause sales_report` |
| Need a failed task's log; `airflow tasks logs` is not a recognized subcommand | Not shipped in this chart's Airflow version | `kubectl exec -n airflow airflow-scheduler-0 -c scheduler -- find /opt/airflow/logs -iname "*<task_id>*"`, then `cat` the `attempt=N.log` file found |
| `airflow-scheduler-0` `OOMKilled`, `exitCode: 137` | LocalExecutor runs every DAG task as a subprocess of the scheduler container itself, not a separate pod — memory footprint is higher than a scheduler-only pod | Already fixed at 1Gi limit in `gitops/apps/airflow.yaml`; if seen on an older checkout, confirm that value landed. `kubectl get pod airflow-scheduler-0 -n airflow -o jsonpath='{.status.containerStatuses[*].lastState}'` confirms the reason before assuming something else is wrong |
| `airflow-create-user-*` Job pod `OOMKilled`, `exitCode: 137` | `airflow users create` runs the full FAB auth-manager CLI, underestimated at the original 128Mi limit | Already fixed at 256Mi limit in `gitops/apps/airflow.yaml`; same `lastState` check as above to confirm before assuming a different cause |
| Grafana `sc-dashboard`/`sc-datasources` sidecar containers repeatedly restarting | `OOMKilled` at the original 64Mi limit — the `k8s-sidecar` image's real steady-state footprint is closer to ~189Mi on the 2.x line | Already fixed at 256Mi limit in `gitops/apps/kube-prometheus-stack.yaml`; `kubectl get pod -n monitoring -l app.kubernetes.io/name=grafana -o jsonpath='{.status.containerStatuses[*].lastState}'` confirms `OOMKilled`/`exitCode: 137` before assuming something else is wrong |
| `curl -u admin:prom-operator ...` returns `401` | Grafana's admin password is chart-generated, not the chart README's documented default | Fetch the real password: `kubectl get secret -n monitoring kube-prometheus-stack-grafana -o jsonpath='{.data.admin-password}' \| base64 -d` |
| `psql -d orders -c 'SELECT * FROM sales_reports'` returns `relation "sales_reports" does not exist` | Connected to the wrong database — the report lives in `orders`, not `airflow`'s own metadata database | Re-run with `-d orders`; `psql -U postgres -l` lists both databases to confirm |

---

## References

- `docs/phases.md` — Phase 7 exit gate: "Nightly DAG produces a report;
  dashboards live"
- `TASKS.md` — Phase 7 log entries, including every live-only bug this
  runbook's checks were designed to catch
- `docs/adr/006-vault-dev-mode-for-lab.md` — original dev-mode trade-off
- `docs/adr/022-vault-standalone-file-storage.md` — standalone/`file`
  storage that superseded it; why Vault now needs unsealing, not
  re-bootstrapping, after a restart
- `docs/adr/010-vault-bootstrap-script.md` — why a script, not
  `standalone` mode
- `docs/adr/016-kube-prometheus-stack-lab-sizing.md` — Alertmanager/
  retention/sizing trade-offs, including the Grafana sidecar OOM fix
- `docs/adr/017-airflow-local-executor.md` — why LocalExecutor (and its
  scheduler-memory consequence)
- `docs/adr/018-airflow-dag-configmap-delivery.md` — why a ConfigMap (and
  its `subPath` hot-reload limitation)
- `docs/adr/019-airflow-metadata-db-shared-cluster.md` — why the "orders"
  database also hosts the "airflow" metadata database (and why the report
  tables land in "orders")
- `docs/adr/020-airflow-kafka-postgres-source-split.md` — why the DAG's
  two tasks (Postgres aggregate, Kafka event count) are independent
- `gitops/data/airflow/README.md` — Airflow directory layout and one-time
  Vault bootstrap notes
- `docs/runbooks/smoke-test.md` — the order-placement flow runbook this
  one complements (a different concern: sync path + messaging, not
  operations)
