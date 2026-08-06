# Task Board

> Coordination blackboard. Every agent reads this before working and updates
> it after finishing. Format: `- [status] (owner) task — notes`
> Statuses: `todo` | `doing` | `review` | `blocked` | `done`
>
> **Keep this board lean.** Log entries are at most 10 lines: outcome,
> branch, and pointers. Details belong in commit messages, PR descriptions,
> and ADRs — those are the durable record. At phase close the orchestrator
> moves the phase's log entries to `docs/phase-logs/phase-<n>.md` and leaves
> a summary of at most 5 lines here.

## Phase 1 — Foundation (owner: platform-engineer) — CODE DONE

- Summary: bootstrap (budget alert + GCS state), vpc, gke modules complete.
  Reviewer APPROVED (3rd pass, 2 fix rounds). Full log:
  `docs/phase-logs/phase-1.md`. Key decisions: ADR-002, ADR-003.
- [todo] (HUMAN) Merge PR #2 into `main`, then apply per the "Apply order"
  in `terraform/README.md` (step 0: one-time
  `gcloud services enable cloudresourcemanager.googleapis.com` — see
  `terraform/bootstrap/README.md`). Attach the real `plan` output before
  each `apply`.

## Phase 2 — Delivery (owner: gitops-engineer) — DONE

- Summary: Argo CD bootstrap (Terraform helm_release) + app-of-apps root
  merged via PR #4. Reviewer APPROVED (1 pass, 0 fix rounds). Human
  verified the exit gate on Kind: `root-app` `Synced`/`Healthy`. Full log:
  `docs/phase-logs/phase-2.md`. Key decision: ADR-005.

## Phase 3 — Secrets (owner: security-engineer) — DONE

- Summary: Vault (dev-mode) + ESO via GitOps, Vault->ESO->pod flow in
  `gitops/secrets-demo/`. Reviewer APPROVED PR #6 (1 pass, 1 fix round).
  Two live-only bugs found and fixed post-merge (PRs #7, #8; see
  `docs/phase-logs/phase-3.md`). Human verified the exit gate on Kind:
  `secret-consumer` pod env reflects the Vault-stored value. Key
  decision: ADR-006.

## Phase 4 — Data (owner: data-engineer) — DONE

- Summary: CloudNativePG operator + single-instance `Cluster` and a plain
  Redis Deployment, both via GitOps, both credentialed from Vault via ESO
  (same Kubernetes-auth pattern as Phase 3). PRs #10-#12 merged. One
  live-only reconciliation race found and fixed post-merge (ExternalSecret
  backoff + stalled Argo CD sync after Vault bootstrap; see
  `docs/phase-logs/phase-4.md`). Human verified the exit gate on Kind:
  `psql`/`redis-cli` connected using Vault-sourced credentials. Key
  decisions: ADR-007 (Redis: plain Deployment), ADR-008 (Postgres:
  CloudNativePG kept).

## Phase 5 — Applications (owner: app-developer) — DONE

- Summary: backend/BFF/frontend/worker (PRs #14, #15) + 4 live-only CI/
  GitOps fixes (PRs #16, #17; see `docs/phase-logs/phase-5.md`) + a Vault
  dev-mode state loss that had silently broken Phase 3/4's secret flow too,
  fixed by re-bootstrapping all 4 Kubernetes-auth roles. Human verified the
  exit gate on Kind: order placed end-to-end (frontend->BFF->backend,
  Postgres row written, Redis cache-aside hit). Key decision: ADR-009.

## Phase 5 fix (owner: security-engineer) — not phase-gating

- (security-engineer) Replaced 4 duplicated manual Vault dev-mode bootstrap
  procedures (secrets-demo, postgres, redis, backend READMEs) with one
  idempotent `scripts/bootstrap-vault.sh`, safe to re-run after any
  `vault-0` restart (dev-mode loses the Kubernetes auth method too, not
  just KV data — verified against HashiCorp's dev-server docs). Considered
  switching to `standalone` mode (ADR-010): rejected, since this lab has no
  auto-unseal/KMS, so unseal-key custody would just recreate the same
  can't-land-in-Git problem the root token already has. Key decision:
  ADR-010 (does not supersede ADR-006). PR: see branch
  `phase-5/vault-bootstrap-fix`.

## Phase 6 — Messaging (owner: data-engineer) — DONE

- Summary: RabbitMQ (PR #23, ADR-011) + Kafka/Strimzi (PR #24, ADR-012)
  wired into backend/worker. Reviewer APPROVED WITH FOLLOW-UPS (all 4
  closed pre-Phase-7: PRs #31, #32). 6 live-only bugs found and fixed
  post-merge (PRs #26-#30), incl. a `root-app` self-deletion incident
  (ADR-014) recovered with no data loss. Human verified the exit gate on
  Kind: order event consumed from both RabbitMQ and Kafka. Full log:
  `docs/phase-logs/phase-6.md`. Key decisions: ADR-011, ADR-012, ADR-013,
  ADR-014, ADR-015.

## Phase 7 — Operations (owner: platform-engineer) — DONE

- Summary: kube-prometheus-stack (PR #36, ADR-016) + Airflow with a
  nightly `sales_report` DAG (PR #38, ADR-017..021) via GitOps. Reviewer
  CHANGES REQUESTED once (resource limits + stale runbook ref), fixed
  and re-reviewed clean. 10 live-only bugs found and fixed post-merge
  (PRs #40, #41, #43-#49; see `docs/phase-logs/phase-7.md`), incl. 3
  chained sync-wave deadlocks, 3 OOMKilled resource limits, an Airflow 3
  context-injection API change, and a Vault dev-mode state loss (same
  class as Phases 3/5/6). Human + orchestrator verified the exit gate
  live on Kind: `sales_report` produced real report rows from both its
  cron schedule and a manual trigger; Grafana serving 28 populated
  dashboards. Full log: `docs/phase-logs/phase-7.md`.
- [done] (technical-writer) README + `docs/order-flow.md` updated with
  Airflow and kube-prometheus-stack, grounded in the merged Phase 7
  state (ADR-016..021). PR #51.
- [done] (technical-writer) New runbook
  `docs/runbooks/airflow-observability-verification.md`: DAG trigger/
  poll/verify + Grafana dashboard/datasource checks, grounded in Phase
  7's real live-verification bugs. PR #52.
- [done] (app-developer) backend `/metrics` via `prom-client` (11/11
  tests pass on Node 22) + new isolated `mermaid-lint.yml` CI job
  validating all Mermaid diagrams with `mmdc`. Branch
  `phase-7/backend-metrics-and-mermaid-ci`, not yet PR'd.

## Log

- (orchestrator) Phase 1 log archived to `docs/phase-logs/phase-1.md`;
  board slimmed per the token-discipline rules added to `CLAUDE.md`.
- (orchestrator) Phase 2 log archived to `docs/phase-logs/phase-2.md`;
  exit gate confirmed by human on Kind (`root-app` `Synced`/`Healthy`).
- (orchestrator) Phase 3 log archived to `docs/phase-logs/phase-3.md`;
  exit gate confirmed by human on Kind (secret flowed Vault->ESO->pod).
- (security-engineer) Added gitleaks pre-commit hook (v8.30.1), doc note in
  `docs/conventions.md`. Verified clean on repo, blocks synthetic secret.
  PR opened from `phase-4/gitleaks-precommit`, not phase-gating.
- (data-engineer) Fixed `gitops/data/redis/deployment.yaml` `runAsGroup`
  999->1000 and its comment: `redis:8.10.0-alpine`'s Dockerfile allocates
  gid 999 already used by Alpine, so `redis` group is gid 1000, user uid
  999. Verified via `docker run redis:8.10.0-alpine id redis` and the
  upstream Dockerfile. No PVC, so no fsGroup impact. PR #12,
  branch `phase-4/redis-securitycontext-fix`, not phase-gating.
- (orchestrator) Phase 4 log archived to `docs/phase-logs/phase-4.md`;
  exit gate confirmed by human on Kind (Postgres `psql` + Redis
  `redis-cli` both authenticated with Vault-sourced credentials). One
  live-only ExternalSecret/Argo-CD-sync race diagnosed and fixed post-merge
  (see phase log).
- (orchestrator) Phase 5 log archived to `docs/phase-logs/phase-5.md`; 7
  live-only bugs found and fixed post-merge (CI permissions, invalid Trivy
  tag, Node 22 `--test` regression, Trivy false positives on npm's own
  bundled deps, private GHCR packages, placeholder image tags, and a Vault
  dev-mode state loss that had also silently broken Phase 3/4). Exit gate
  confirmed live on Kind: order placed end-to-end, Postgres write + Redis
  cache-aside hit both verified.
- (orchestrator) Phase 6 log archived to `docs/phase-logs/phase-6.md`;
  reviewer APPROVE WITH FOLLOW-UPS, all 4 closed (PRs #31, #32). Exit gate
  confirmed live on Kind: order event consumed from both RabbitMQ (worker
  log) and Kafka (`gate-verifier` consumer on `order-events`).
- (orchestrator) Phase 7 log archived to `docs/phase-logs/phase-7.md`; 10
  live-only bugs found and fixed post-merge (PRs #40, #41, #43-#49,
  chained sync-wave deadlocks + OOMKilled limits + an Airflow 3 API
  change). Exit gate confirmed live on Kind: `sales_report` produced real
  report rows (cron + manual trigger), Grafana serving 28 populated
  dashboards.
