# Phase 5 — Applications

Owner: app-developer. Exit gate (docs/phases.md): order placed end-to-end
through frontend -> BFF -> backend -> PostgreSQL/Redis, verified live on Kind.

## Summary

- Batch 1 (PR #14, `phase-5/app-services`): backend/BFF/frontend/worker app
  code (Node.js 22, Express), Dockerfiles (multi-stage, non-root `USER node`),
  and one reusable CI pipeline per service (build->test->scan->push via
  GHCR/Trivy). Backend implements a real cache-aside catalog read (Redis)
  and transactional order writes (Postgres); worker is an explicitly
  labeled Phase 6 placeholder (heartbeat only, no queue).
- Batch 2 (PR #15, `phase-5/gitops-services`): `gitops/services/{backend,
  bff,frontend,worker}/` plain manifests (ADR-009: plain manifests over a
  Helm chart — the four services are structurally similar but not
  parameter-identical), Vault wiring for backend only (reuses Phase 4's
  `secret/postgres`/`secret/redis` KV paths via a new `backend` role), doc
  corrections (`docs/architecture.md`, `gitops/apps/README.md`).
- Reviewer APPROVED both batches together (1 pass, 1 should-fix: an
  information-disclosure bug in the Express error handlers echoing
  `err.message` on unexpected 500s — fixed pre- and post-review across all
  three HTTP services, commits `fc69e8c`/`4709162`).

## Live-only bugs found and fixed post-merge

CI failed on `main` after PR #14/#15 merged; none of these were catchable
pre-merge (masked by Node 18 locally, or only surfaced once Actions ran
for real):

1. **Repo `default_workflow_permissions: read`** blocked the `packages:
   write` the CI workflows declare — `startup_failure`, zero jobs run.
   Fixed by raising the repo default to `write` (human-approved).
2. **`aquasecurity/trivy-action@0.36.0`** (missing the `v` prefix every
   real release tag uses) — invalid ref, `scan` job failed at "Set up
   job". Fixed: `@v0.36.0`.
3. **`node --test test/`** throws `MODULE_NOT_FOUND` on Node 22.23.2
   (works on Node 18) — reproduced in `node:22.23.2-alpine3.24`. Fixed by
   switching all four `package.json` `test` scripts to the argument-less
   `node --test` (Node's documented default recursive-discovery form,
   version-stable).
4. **Trivy correctly found CRITICAL/HIGH CVEs** — all inside
   `/usr/local/lib/node_modules/npm` (the base image's own bundled npm
   CLI, never invoked at runtime). `npm audit` confirmed 0 vulnerabilities
   in each service's own dependencies. Fixed by scoping the scan with
   `skip-dirs` to exclude npm's bundled tree from the gate.
   (PR #16, `phase-5/ci-fixes`, all four fixes.)
5. **GHCR defaults new container packages to private**, even on a public
   repo — would have caused `ImagePullBackOff` on Kind. Human made the 4
   packages public via the GHCR UI (no API scope available for a
   user-owned package's visibility).
6. **`:latest-dev` placeholder tags** in `gitops/services/*/deployment.yaml`
   replaced with the real CI-pushed tag (`ed1a6ca9...`, the `main` merge
   commit whose CI push job first ran end-to-end) once confirmed live via
   `docker pull`. (PR #17, `phase-5/pin-image-tags`.)
7. **Vault dev-mode lost all state** (in-memory storage, ADR-006) since
   the last bootstrap — not just the new `backend` role, the entire
   `kubernetes` auth method, and Phase 3/4's `eso`/`postgres`/`redis`
   roles and KV data were gone, silently breaking Phase 3/4's exit gates
   too (`SecretSyncedError` on `postgres-app-credentials`/`redis-credentials`
   for ~14h, unnoticed until this phase's Argo CD sync surfaced it as a
   blocked wave). Re-bootstrapped the kubernetes auth method, re-seeded
   `secret/postgres`/`secret/redis` with their existing live values
   (verified via `psql`/`redis-cli` against the running pods before
   rewriting Vault, so credentials stayed consistent with what Postgres/
   Redis already had baked in), and recreated all 4 policy/role pairs
   (`eso`, `postgres`, `redis`, `backend`). Root cause of the stuck sync:
   Argo CD's app-of-apps applies the whole `gitops/` tree in one operation
   with wave-ordered health gating — an unrelated, unhealthy wave-1
   resource anywhere in the tree (Phase 3's `secrets-demo` SecretStore)
   blocked wave 2 everywhere, including Phase 5's Deployments.

## Exit gate verification (human + orchestrator, live on Kind)

```
curl -s http://localhost:8082/api/catalog
curl -s -X POST http://localhost:8082/api/orders -d '{"productId":1,"quantity":2}'
# -> {"orderId":1,"productId":1,"quantity":2,"totalCents":2598}
```

Confirmed in Postgres: `orders` row `id=1, product_id=1, quantity=2,
total_cents=2598`. Confirmed in Redis: `catalog:items` holds the cached
product list (cache-aside, not a pass-through). All four pods
(`backend`, `bff`, `frontend`, `worker`) `1/1 Running`, `root-app`
`Synced`/`Healthy`.

## Key decisions

- ADR-009: plain manifests for backend/BFF/frontend/worker (not a Helm
  chart) — the four services are structurally similar but not
  parameter-identical (only backend has Vault wiring, only worker has no
  Service).
