# Vision

## Why this project exists

This lab reproduces the day-to-day reality of a senior DevOps/platform
engineer: infrastructure as code, GitOps delivery, secure secret management,
data services operated via Kubernetes operators, asynchronous messaging, and
batch orchestration — all under real cost constraints.

It is also an experiment in AI agent orchestration: specialized agents build
the project autonomously, coordinated by an orchestrator session, with a human
observing and intervening only at defined gates.

## The scenario

A simplified e-commerce order platform. Every component exists because the
scenario needs it — no tool is included for its own sake:

| Component  | Role                                                            |
|------------|-----------------------------------------------------------------|
| Frontend   | Storefront UI                                                   |
| BFF        | Backend-for-frontend: aggregates backend calls for the UI       |
| Backend    | Orders/catalog API (business logic)                             |
| PostgreSQL | Transactional store for orders                                  |
| Redis      | Catalog cache and sessions                                      |
| RabbitMQ   | Task queue: order created → worker sends email/invoice          |
| Kafka      | Immutable event log: order lifecycle events for many consumers  |
| Airflow    | Nightly batch ETL: aggregate events into sales reports          |
| Vault      | Secret management for everything above                          |

## Definition of success

1. A user can place an order end-to-end through the deployed stack.
2. Every piece of infrastructure is reproducible from Git alone
   (`terraform apply` + Argo CD sync from a clean project).
3. The whole environment can be destroyed and recreated (ephemeral by design).
4. Any engineer can understand each module in one reading — the codebase is
   deliberately simple.
5. Monthly cloud spend stays within the budget defined in the platform module.

## Explicit non-goals

- High availability and multi-region setups
- Production hardening beyond sensible defaults
- Feature-rich applications: app code is intentionally minimal; the platform
  is the product
