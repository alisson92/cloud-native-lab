# cloud-native-lab

A cloud-native lab that reproduces the day-to-day reality of a platform/SRE
engineer: infrastructure as code, GitOps delivery, secret management,
Kubernetes-operated data services, asynchronous messaging, batch
orchestration, and observability — under real cost constraints. It is also
an experiment in AI agent orchestration: specialized agents build the
project, coordinated by an orchestrator session, with a human observing and
approving at defined gates.

Full context lives in [`docs/`](docs/); this file is an entry point, not a
replacement for it. See [`docs/vision.md`](docs/vision.md) for the complete
rationale and non-goals.

## The scenario

A simplified e-commerce order platform. Every component exists because the
scenario needs it:

| Component  | Role                                                       |
|------------|--------------------------------------------------------------|
| Frontend   | Storefront UI (static page + a thin proxy to the BFF)        |
| BFF        | Backend-for-frontend: proxies/aggregates backend calls        |
| Backend    | Orders/catalog API (business logic, source of truth writes)   |
| PostgreSQL | Transactional store for orders (via the CloudNativePG operator) |
| Redis      | Catalog cache (cache-aside)                                   |
| RabbitMQ   | Task queue: order created → worker sends email/invoice (stub) |
| Kafka      | Immutable event log: order lifecycle events, consumed by Airflow |
| Airflow    | Nightly batch ETL: aggregates orders/events into sales reports |
| Vault      | Secret management for every credentialed service above        |
| Prometheus / Grafana | Cluster metrics + dashboards (observability)          |

`docs/vision.md`'s non-goals apply throughout: no high availability, no
production hardening beyond sensible defaults, minimal application code —
the platform is the product, not the storefront.

## Status: through Phase 7

This README describes the system **as it stands through Phase 7** (see
`TASKS.md`): Foundation, Delivery, Secrets, Data, Applications, Messaging,
and Operations (Airflow ETL + kube-prometheus-stack observability) are done
and merged, and the Phase 7 exit gate (nightly DAG produces a report,
dashboards live) was verified on a Kind cluster.

## Architecture

Everything below `gitops/` is reconciled by Argo CD from a single
app-of-apps root (`gitops/root-app.yaml`). Infra components and full-stack
Helm-chart Applications (Vault, External Secrets Operator, the CloudNativePG
operator, the Strimzi operator, Airflow, kube-prometheus-stack) live under
`gitops/apps/`; data workloads and application services live under
`gitops/data/` and `gitops/services/`.

```mermaid
flowchart TB
    subgraph client["Client"]
        Browser
    end

    subgraph argocd_ns["namespace: argocd"]
        ArgoCD["Argo CD\n(root-app, app-of-apps)"]
    end

    subgraph apps_ns["namespace: apps"]
        Frontend["frontend\n(Express, static UI + proxy)"]
        BFF["bff\n(Express, proxy)"]
        Backend["backend\n(Express API)"]
        Worker["worker\n(plain Node process)"]
    end

    subgraph postgres_ns["namespace: postgres"]
        Postgres[("PostgreSQL\nCloudNativePG Cluster, 1 instance")]
    end

    subgraph redis_ns["namespace: redis"]
        Redis[("Redis\nplain Deployment")]
    end

    subgraph rabbitmq_ns["namespace: rabbitmq"]
        RabbitMQ["RabbitMQ\nplain Deployment"]
    end

    subgraph kafka_ns["namespace: kafka"]
        Strimzi["Strimzi Cluster Operator"]
        Kafka["Kafka cluster\n(1-node, KRaft dual-role)\ntopic: order-events"]
    end

    subgraph vault_ns["namespace: vault"]
        Vault["Vault (dev mode)"]
    end

    subgraph eso_ns["namespace: external-secrets"]
        ESO["External Secrets Operator"]
    end

    subgraph cnpg_ns["namespace: cnpg-system"]
        CNPGOp["CloudNativePG Operator"]
    end

    subgraph airflow_ns["namespace: airflow"]
        AirflowSched["Airflow scheduler\n(LocalExecutor, chart 1.22.0)\nDAG: sales_report (nightly, 02:00 UTC)"]
    end

    subgraph monitoring_ns["namespace: monitoring"]
        Prometheus["Prometheus\n(kube-prometheus-stack)"]
        Grafana["Grafana\n(bundled default dashboards)"]
        KSM["kube-state-metrics"]
        NodeExporter["node-exporter"]
    end

    Browser -->|HTTP| Frontend
    Frontend -->|HTTP /catalog /orders| BFF
    BFF -->|HTTP /catalog /orders| Backend
    Backend -->|SQL| Postgres
    Backend -->|cache-aside GET/SET| Redis
    Backend -->|publish orders.created\nAMQP| RabbitMQ
    Backend -->|produce order-events\nSASL/SCRAM| Kafka
    RabbitMQ -->|consume orders.created| Worker

    AirflowSched -->|SQL: read orders/products\nwrite sales_reports| Postgres
    AirflowSched -->|consume order-events\nSASL/SCRAM, write kafka_event_counts| Kafka

    Prometheus -->|scrape| KSM
    Prometheus -->|scrape| NodeExporter
    Grafana -->|query, bundled default dashboards| Prometheus

    Vault -.->|secrets via ESO| ESO
    ESO -.->|ExternalSecret -> Secret| Backend
    ESO -.->|ExternalSecret -> Secret| Worker
    ESO -.->|ExternalSecret -> Secret| Postgres
    ESO -.->|ExternalSecret -> Secret| Redis
    ESO -.->|ExternalSecret -> Secret| RabbitMQ
    ESO -.->|ExternalSecret -> Secret| Kafka
    ESO -.->|ExternalSecret -> Secret\n(metadata DB, Postgres conn, Kafka conn)| AirflowSched

    CNPGOp -.->|reconciles\norders + airflow databases,\nsame Cluster| Postgres
    Strimzi -.->|reconciles| Kafka

    ArgoCD -.->|reconciles all of the above\nfrom gitops/| apps_ns
    ArgoCD -.-> postgres_ns
    ArgoCD -.-> redis_ns
    ArgoCD -.-> rabbitmq_ns
    ArgoCD -.-> kafka_ns
    ArgoCD -.-> vault_ns
    ArgoCD -.-> eso_ns
    ArgoCD -.-> cnpg_ns
    ArgoCD -.-> airflow_ns
    ArgoCD -.-> monitoring_ns
```

Notes grounded in the actual manifests (not the original plan):

- BFF and frontend have **no** Vault wiring — they hold no credentials
  (pure HTTP proxies), so no `SecretStore`/`ExternalSecret` exists for them
  (`gitops/services/README.md`).
- Worker has its **own** Vault identity (`worker-vault-auth`), scoped only
  to RabbitMQ credentials — it does not reuse backend's.
- Redis and RabbitMQ are plain `Deployment`s with no operator and no PVC
  (ADR-007, ADR-011): losing unconsumed cache/queue data on a pod restart
  is an accepted trade-off in this ephemeral lab.
- Postgres uses the CloudNativePG operator, 1 instance, no HA (ADR-008).
  Kafka uses the Strimzi operator, 1-node KRaft cluster, no HA (ADR-012).
- Kafka's internal listener is plaintext with SASL/SCRAM-SHA-512
  authentication — no TLS, consistent with every other in-cluster service
  trusting the cluster network boundary.
- The backend's `KafkaUser` is producer-only (`Describe`+`Write` on
  `order-events`). Airflow's own `KafkaUser` (`airflow`, read-only
  `Describe`+`Read` on `order-events` plus `Read` on its consumer group
  `airflow-sales-report`) is the real, workload-backed reader — it replaced
  the debug-only `gate-verifier` identity from Phase 6 (ADR-015's
  Consequences, `gitops/data/kafka/airflow-user.yaml`).
- Airflow runs with `LocalExecutor` (ADR-017): the scheduler pod also runs
  every DAG task as a subprocess — there is no separate Celery worker
  Deployment and no broker. Its single DAG (`sales_report`,
  `gitops/data/airflow/dags-configmap.yaml`) is delivered as a `ConfigMap`
  mounted into the DAGs folder (ADR-018), not `git-sync`. It has two
  independent, unchained tasks (ADR-020): `aggregate_daily_sales` (reads
  `orders`/`products` from Postgres, writes `sales_reports`) and
  `consume_order_events` (reads the `order-events` Kafka topic, writes
  `kafka_event_counts`).
- Airflow's metadata database is **not** a dedicated Postgres instance — it
  is a second `Database` (`airflow`, owned by its own managed role) inside
  the same CloudNativePG `postgres` Cluster that already holds `orders`
  (ADR-019, `gitops/data/postgres/airflow-database.yaml`). Both DAG tasks
  also write their output tables into that same database — this lab has no
  separate reporting warehouse.
- kube-prometheus-stack ships Prometheus + Grafana + kube-state-metrics +
  node-exporter; Alertmanager is deliberately disabled (no configured
  receiver in this lab, ADR-016). Grafana serves the chart's own bundled
  default dashboards — no custom dashboards are authored in this repo.
  Neither Prometheus nor Grafana persists to a PVC (`emptyDir`, same
  ephemeral-by-design trade-off as Redis/RabbitMQ, ADR-016). The
  application tier (backend/BFF/frontend/worker) exposes no `/metrics`
  endpoint yet, so Prometheus only scrapes cluster-level targets
  (kube-state-metrics, node-exporter) — there is no `ServiceMonitor` for
  the app tier in this repo.

See [`docs/order-flow.md`](docs/order-flow.md) for how an order actually
moves through the sync path and both async paths — that flow is unchanged
by Phase 7; Airflow reads from Postgres/Kafka independently, outside the
request path.

## Repository layout

```
local/kind/     # Local Kind cluster config (not Terraform-managed)
terraform/      # Foundation (GCP/GKE) + delivery (Argo CD bootstrap)
gitops/         # Everything Argo CD reconciles
  root-app.yaml # App-of-apps root
  apps/         # Infra Application manifests (vault, ESO, cnpg operator,
                # strimzi, airflow, kube-prometheus-stack)
  data/         # Data workloads (postgres, redis, rabbitmq, kafka, airflow)
  services/     # Application workloads (backend, bff, frontend, worker)
apps/           # Application source code, one directory per service
docs/           # Vision, architecture, phases, conventions, ADRs, phase logs
scripts/        # Operational scripts (e.g. Vault dev-mode bootstrap)
```

## Running it locally (Kind)

This lab targets a local [Kind](https://kind.sigs.k8s.io/) cluster before
any cloud spend, per
[`docs/adr/004-local-first-validation-with-kind.md`](docs/adr/004-local-first-validation-with-kind.md).

1. **Create the cluster**

   ```sh
   kind create cluster --config local/kind/kind-config.yaml
   ```

   See [`local/kind/README.md`](local/kind/README.md).

2. **Bootstrap Argo CD + the app-of-apps root**

   ```sh
   cd terraform/delivery
   terraform init
   terraform apply -target=module.argocd \
     -var="kubeconfig_context=kind-cloud-native-lab" \
     -var="argocd_chart_version=10.2.2" \
     -var="gitops_repo_url=https://github.com/alisson92/cloud-native-lab.git"
   terraform apply \
     -var="kubeconfig_context=kind-cloud-native-lab" \
     -var="argocd_chart_version=10.2.2" \
     -var="gitops_repo_url=https://github.com/alisson92/cloud-native-lab.git"
   ```

   Two-phase apply is required — see
   [`terraform/delivery/README.md`](terraform/delivery/README.md) for why.
   Argo CD then reconciles everything under `gitops/` on its own.

3. **Bootstrap Vault** (dev mode loses its Kubernetes auth method and KV
   data on every restart, so this is re-run after any `vault-0` restart)

   ```sh
   ./scripts/bootstrap-vault.sh
   ```

   See the script's own header comment and
   [`docs/adr/010-vault-bootstrap-script.md`](docs/adr/010-vault-bootstrap-script.md).

4. **Wait for everything to sync**

   ```sh
   kubectl -n argocd get application
   # root-app and every child Application should be Synced/Healthy.
   ```

5. **Place an order end-to-end**

   ```sh
   kubectl -n apps port-forward svc/frontend 8082:8082
   # http://localhost:8082/ in a browser: browse the catalog, place an order.
   ```

   Confirm the worker picked up the RabbitMQ message:

   ```sh
   kubectl -n apps logs deploy/worker
   # "order <id>: sending email + invoice (stub) ..."
   ```

6. **Check the Airflow DAG and the Grafana dashboards**

   ```sh
   kubectl -n airflow get pod
   # scheduler, api-server, dag-processor: Running.

   # Trigger a run manually rather than waiting for the 02:00 UTC schedule:
   kubectl -n airflow exec deploy/airflow-scheduler -- airflow dags trigger sales_report

   # After it completes, check the two tables it writes (both in the
   # "orders" database, shared with the application tier):
   kubectl -n postgres exec -it postgres-1 -- psql -U orders -d orders \
     -c 'SELECT * FROM sales_reports ORDER BY generated_at DESC LIMIT 10;'
   kubectl -n postgres exec -it postgres-1 -- psql -U orders -d orders \
     -c 'SELECT * FROM kafka_event_counts ORDER BY generated_at DESC LIMIT 10;'
   ```

   See [`gitops/data/airflow/README.md`](gitops/data/airflow/README.md) for
   the full exit-gate verification, including `ExternalSecret`/`Database`/
   `KafkaUser` readiness checks.

   ```sh
   kubectl -n monitoring get svc
   # Find the Grafana Service name, then port-forward it, e.g.:
   kubectl -n monitoring port-forward svc/<grafana-service-name> 3000:80
   # http://localhost:3000/ — the chart's bundled default dashboards are
   # pre-provisioned; default admin credentials are the chart's own
   # (see the kube-prometheus-stack chart's Grafana subchart docs).
   ```

7. **Tear down**

   ```sh
   kind delete cluster --name cloud-native-lab
   ```

For the full sequence including GKE, see
[`terraform/README.md`](terraform/README.md).

## Documentation map

- [`docs/vision.md`](docs/vision.md) — why this project exists, the
  scenario, definition of success.
- [`docs/architecture.md`](docs/architecture.md) — build order, integration
  map, repository layout, architectural principles.
- [`docs/phases.md`](docs/phases.md) — phase ownership and exit gates.
- [`docs/conventions.md`](docs/conventions.md) — language, Git, Terraform,
  Kubernetes/GitOps, and documentation conventions.
- [`docs/adr/`](docs/adr/) — architectural decision records (the "why"
  behind every non-default choice).
- [`docs/phase-logs/`](docs/phase-logs/) — archived per-phase task logs.
- [`docs/order-flow.md`](docs/order-flow.md) — order flow diagram (sync +
  both async paths), grounded in `apps/backend/src/` and
  `apps/worker/src/`.

## License

No license file is present; treat this repository as "all rights reserved"
unless a `LICENSE` file is added.
