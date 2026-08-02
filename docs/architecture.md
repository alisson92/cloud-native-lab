# Architecture

## Layers (build order = dependency order)

1. **Foundation** — GCP project, budget alert, VPC, GKE (zonal, Spot node
   pool), Terraform state in a GCS bucket.
2. **Delivery** — Argo CD installed via Terraform (bootstrap only), then
   app-of-apps pattern: one root Application pointing at `gitops/`.
3. **Secrets** — Vault (dev-appropriate setup) + External Secrets Operator.
   No secret ever lands in Git or in plain `values.yaml`.
4. **Data** — PostgreSQL via CloudNativePG operator; Redis via a simple,
   well-supported deployment (see ADR-007 for Redis, ADR-008 for the
   Postgres-operator trade-off).
5. **Applications** — backend → BFF → frontend. Each service: one container,
   one Helm chart or plain manifests (whichever is simpler), one CI pipeline.
6. **Messaging** — RabbitMQ (task queue) first; Kafka via Strimzi operator
   second. Distinct roles, both justified by the scenario.
7. **Operations** — Airflow (batch ETL) and observability
   (kube-prometheus-stack), added last.

## Integration map

```
frontend ──HTTP──> BFF ──HTTP──> backend ──SQL──> PostgreSQL
                                    │──cache──> Redis
                                    │──publish──> RabbitMQ ──> worker (email/invoice)
                                    └──produce──> Kafka (order events)
Airflow ──consume──> Kafka / PostgreSQL ──write──> reports
Vault ──ExternalSecrets──> all services (credentials)
Argo CD ──reconcile──> everything under gitops/
```

## Repository layout

```
local/
  kind/             # Local Kind cluster config (not Terraform-managed; see docs/adr/004)
terraform/          # Foundation + bootstrap + delivery (modules kept minimal)
gitops/             # Everything Argo CD reconciles
  root-app.yaml     # App-of-apps root Application (watches gitops/ recursively)
  apps/             # Infra Argo CD Application manifests, Helm-chart-sourced
                    # (vault, external-secrets, cloudnativepg-operator), from
                    # Phase 3 onward — not per-service application workloads
  services/         # Per-service plain manifests for the application tier
                    # (backend, bff, frontend, worker), from Phase 5 onward
apps/
  backend/
  bff/
  frontend/
  worker/
docs/               # This documentation + ADRs
```

## Architectural principles

- **Simplest thing that works.** A plain Deployment beats a Helm chart when a
  chart adds nothing. A managed default beats a tuned custom value.
- **One reason per tool.** If a component's role cannot be stated in one
  sentence tied to the scenario, it does not belong here.
- **Official docs drive design.** Installation and configuration follow the
  official documentation of each project. Community blog posts may inspire,
  never decide.
- **Decisions become ADRs.** Any choice between alternatives (operator vs
  chart, chart vs manifests, tool X vs Y) is recorded in `docs/adr/` with
  context, decision, and consequences.
