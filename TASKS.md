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

## Phase 6 — Messaging (owner: data-engineer)

- [review] (data-engineer) Batch 1/2: RabbitMQ task queue, backend
  publishes on order commit, worker consumes (stub email/invoice). PR #23,
  branch `phase-6/rabbitmq`, based on `phase-5/vault-bootstrap-fix` (PR
  #22, unmerged). Worker got its first Vault/ESO wiring, scoped to
  `secret/data/rabbitmq` only via a distinct `worker-vault-auth` SA (see
  PR body: deviation from brief's literal `vault-auth` naming, for
  least-privilege). Key decision: ADR-011. Kafka is batch 2, untouched.
- [review] (data-engineer) Batch 2/2: Kafka (Strimzi, KRaft), `order-events`
  topic, backend publishes there via new `kafka.js`
  (`@confluentinc/kafka-javascript` — kafkajs is unmaintained since 2023).
  PR #24, branch `phase-6/kafka`, based on `phase-6/rabbitmq`.
  `KafkaUser` credentialed from Vault (`secret/kafka`) via a pre-existing
  Secret referenced in `spec.authentication.password.valueFrom` — brief's
  hard requirement met, no fallback needed. Key decision: ADR-012.
- [review] (data-engineer) Phase-gate fix on PR #24: backend's unconditional,
  unguarded `createKafkaProducer()` at startup raced the `KafkaUser` CR
  (wave 3), deadlocking Argo CD at wave 2 on a fresh sync. Fixed by moving
  `gitops/services/backend/deployment.yaml` to sync-wave "4" (Option A —
  simpler than hand-rolling retry logic the Kafka client doesn't natively
  support; confirmed bff/frontend don't depend on backend's health at sync
  time). ADR-012 Consequences updated; backend README exit-gate section
  extended with the full RabbitMQ+Kafka order-flow verification.

## Tooling — Automated gitops image-tag bump (not phase-gating)

- (app-developer) Added `bump-gitops` job to `.github/workflows/service-ci.yml`:
  after `push` lands a new image on `main`, it bumps
  `gitops/services/<service>/deployment.yaml`'s tag to the new sha on a
  stable, force-pushed `ci/bump-<service>-image` branch and opens/updates a
  PR (`gh pr create`/`gh pr edit`) — never merges (human gate preserved).
  Job-scoped `permissions: contents: write, pull-requests: write`. Fixes the
  stale-tag issue flagged in Phase 5 (PR #17) and currently pending on
  Phase 6's backend/worker. Key decision: ADR-013. Human must also enable
  repo setting "Allow GitHub Actions to create and approve pull requests"
  (one-time, see ADR-013). Branch `ci/automate-image-tag-bump`.

## Phase 6 fix (owner: security-engineer) — not phase-gating

- (security-engineer) Fixed root-app sync failure: backend and worker's
  SecretStores both named `vault-backend` in the shared `apps` namespace
  collided into one object (namespace+kind+name identity), blocking the
  whole tree's sync (RepeatedResourceWarning). Renamed worker's to
  `vault-backend-worker`; backend untouched. Verified no other
  SecretStore name collisions exist elsewhere in gitops/ (all others are
  in distinct namespaces). Branch `phase-6/fix-secretstore-name-collision`.

## Phase 6 fix (owner: app-developer) — not phase-gating

- (app-developer) Backfilled stale gitops image tags: `bump-gitops` (PR #25)
  landed after the worker-ci (PR #23, sha `11d7e034...`) and backend-ci
  (PR #24, sha `ca05f6b8...`) push builds ran, so the cluster was still
  running the pre-Phase-6 image (worker's old heartbeat loop, not the real
  RabbitMQ consumer). Bumped both `gitops/services/{backend,worker}/
  deployment.yaml` tags to those shas; both confirmed pullable via
  `docker pull` before commit. Branch `phase-6/backfill-image-tags`.

## Phase 6 fix (owner: data-engineer) — not phase-gating

- (data-engineer) Fixed root-app sync failure: `KafkaUser` "backend"
  declares `authorization.type: simple` ACLs but the `Kafka` CR had no
  `spec.kafka.authorization` block, so Strimzi's User Operator rejected
  it (wave-3 hook failure blocking wave 4/backend). Added
  `authorization: {type: simple}` to `cluster.yaml` (Strimzi's
  StandardAuthorizer in KRaft); no `superUsers` needed — Strimzi
  auto-bootstraps its own internal components as super users (issue
  #12913). Validated via `kubectl explain` against the live CRD. PR #28,
  branch `phase-6/fix-kafka-authorization`.

## Phase 6 fix (owner: gitops-engineer) — not phase-gating

- (gitops-engineer) Diagnosed live `root-app` `Synced`/`Degraded`: NOT a
  sync/cache artifact (manual `argocd app sync root-app --core` confirmed
  no change). Real cause: Vault dev-mode `vault-0` pod restarted (node
  restart), wiping its Kubernetes auth method (in-mem storage) — 8
  ExternalSecret/SecretStore resources genuinely Degraded (403 on Vault
  login), correctly rolled up. **Needs `scripts/bootstrap-vault.sh` re-run
  (security-engineer/human) — outside this agent's scope, not done here.**
  Separately fixed (unrelated, doesn't affect the incident): `root-app.yaml`
  was tracking itself via `directory.recurse` — excluded via
  `directory.exclude`, matching Argo CD's official app-of-apps example.
  ADR-014. PR #29, branch `phase-6/exclude-root-app-self-reference`.

## Phase 6 fix (owner: data-engineer) — not phase-gating

- (data-engineer) PR #28's `authorization: simple` fix left no Kafka
  identity able to read `order-events` (`backend` is producer-only by
  design). Added read-only `KafkaUser` "gate-verifier"
  (`gitops/data/kafka/gate-verifier-user.yaml`): `Describe`+`Read` on
  `order-events`, `Read` on its own fixed consumer group. Strimzi-generated
  password (not Vault-sourced — debug-only identity, no consuming
  workload; `scripts/bootstrap-vault.sh` untouched, no human re-run
  needed). ADR-015. Updated `gitops/data/kafka/README.md` and
  `gitops/services/backend/README.md`'s now-stale consume example.

## Phase 6 fix (owner: data-engineer) — not phase-gating

- (data-engineer) Reviewer follow-up: ADR-012's Consequences never mentioned
  PR #28's `spec.kafka.authorization` fix nor that its own producer-only ACL
  design is what forced ADR-015's `gate-verifier` addition. Appended an
  "Also harder" addendum (same style as the existing sync-wave entry)
  documenting both, cross-referencing ADR-015. Docs-only, no manifest
  change. Branch `phase-6/adr-012-authorization-addendum`.

## Phase 6 fix (owner: gitops-engineer) — not phase-gating

- (gitops-engineer) Reviewer follow-up on PR #29: `root-app` already had
  `syncPolicy.automated.prune: true` and was already self-tracking
  `Application/argocd/root-app` when the `directory.exclude` fix merged —
  the very next auto-sync pruned root-app's own `Application` object
  (no cascade: no finalizer, all workloads stayed `Running`). Human
  recreated via `kubectl apply -f gitops/root-app.yaml`; confirmed
  `Synced`/`Healthy`, no longer self-tracking. ADR-014 Consequences
  corrected. Added a `docs/conventions.md` rule: `root-app.yaml`
  syncPolicy/directory changes need `argocd app diff --local` (or
  `kubectl diff`) before merge. `terraform/delivery` state was stale
  (missing the `exclude` field the human applied by hand) — `plan` shows
  a safe 1-attribute in-place update, no destroy/recreate; human should
  run `terraform apply` to reconcile state, no drift otherwise. Branch
  `phase-6/fix-root-app-self-prune-followup`.

## Phase 7 — Operations

- [todo] To be broken down by the orchestrator when Phase 6 gate passes.
  Definitions live in `docs/phases.md`.

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
