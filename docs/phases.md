# Phases

Each phase has an owner (agent), an entry condition, and an exit gate.
A phase starts only when the previous gate is passed. Work inside a phase can
be parallelized when tasks are independent.

| # | Phase        | Owner              | Delivers                                             | Exit gate                                             |
|---|--------------|--------------------|------------------------------------------------------|-------------------------------------------------------|
| 1 | Foundation   | platform-engineer  | Terraform: GCP project config, budget alert, VPC, GKE, GCS state | `terraform validate` + `plan` clean; reviewer approval; **human runs apply** |
| 2 | Delivery     | gitops-engineer    | Argo CD bootstrap + app-of-apps root                 | Root app synced and healthy                           |
| 3 | Secrets      | security-engineer  | Vault + External Secrets Operator, via GitOps        | A test secret flows Vault → ESO → pod                 |
| 4 | Data         | data-engineer      | CloudNativePG cluster + Redis, via GitOps            | Both reachable in-cluster; credentials from Vault     |
| 5 | Applications | app-developer      | backend, BFF, frontend, worker + CI per service      | Order placed end-to-end (sync path, no messaging yet) |
| 6 | Messaging    | data-engineer      | RabbitMQ, then Kafka (Strimzi), wired into backend   | Order event consumed from both systems                |
| 7 | Operations   | platform-engineer  | Airflow ETL + kube-prometheus-stack                  | Nightly DAG produces a report; dashboards live        |

## Rules

- The budget alert in Phase 1 is created **before any other billable
  resource**. This is non-negotiable.
- The reviewer agent must approve every phase exit.
- Human gates (see `CLAUDE.md`) apply in every phase: `terraform apply`,
  `terraform destroy`, and merges to the Argo CD-watched branch are proposed
  by agents and executed only by the human operator.
- If a phase reveals a flaw in a previous phase, fix the previous phase first.
  No workarounds layered on top of known problems.
