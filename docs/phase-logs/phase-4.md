# Phase 4 — Data (archived log)

- Owner: data-engineer. Delivered CloudNativePG operator + single-instance
  `Cluster` (`gitops/data/postgres/`) and a plain Redis `Deployment`
  (`gitops/data/redis/`), both via GitOps, both credentialed from Vault
  through the same Kubernetes-auth SecretStore -> ExternalSecret pattern
  established in Phase 3 (ADR-006).
- PR #11 (`phase-4/data-services`): CloudNativePG operator Application
  (wave 0), namespace/ServiceAccount/SecretStore/ExternalSecret (wave 1),
  Cluster CR / Redis Deployment+Service (wave 2). Reviewer APPROVED WITH
  NITS (1 pass, 0 fix rounds). ADR-007 (Redis: plain Deployment, no
  operator) and ADR-008 (CloudNativePG operator kept over a hand-rolled
  StatefulSet) written and merged.
- PR #10 (`phase-4/gitleaks-precommit`, security-engineer, parallel batch):
  gitleaks pre-commit hook (v8.30.1) added as a mechanical secret-scanning
  guardrail. Not phase-gating.
- PR #12 (`phase-4/redis-securitycontext-fix`): follow-up fix for a
  reviewer nit — `runAsGroup` corrected from 999 to 1000 to match
  `redis:8.10.0-alpine`'s actual GID (Alpine already reserves gid 999 for
  a system group, so the image's `redis` group lands on gid 1000). No
  functional bug, comment/value correction only.
- **Live-only bug found and fixed post-merge** (same class as Phase 3's
  PRs #7/#8): after the human ran the manual Vault bootstraps for
  `postgres` and `redis`, both `ExternalSecret`s reported
  `SecretSyncedError`. Root cause was a reconciliation race, not a config
  error:
  1. The `postgres`/`redis` `SecretStore`s attempted Vault Kubernetes-auth
     login before the human finished writing the Vault roles/policies,
     so ESO recorded `InvalidProviderConfig` several times.
  2. Once the bootstrap completed, the `SecretStore`s self-healed (a fresh
     manual login via `vault write auth/kubernetes/login` confirmed the
     roles/policies were correct all along).
  3. The `ExternalSecret`s had already entered controller-runtime's
     exponential backoff from the accumulated errors and would not retry
     for several minutes on their own.
  4. `root-app` in Argo CD had exhausted its 5 sync retries during that
     same failing window, so the wave-2 workloads (`Cluster` CR, Redis
     `Deployment`) were never created even after the underlying secret
     issue disappeared.
  - Fix (operational, no Git/declared-state change): forced an ESO
    `force-sync` annotation on both `ExternalSecret`s to break the
    backoff, then triggered a fresh Argo CD sync on `root-app` to
    reach wave 2.
- **Exit gate verified live on Kind**: `Cluster postgres` reports
  `Cluster in healthy state` (1/1 instance); `psql -U orders -d orders`
  authenticated with the Vault-sourced password and returned
  `current_user=orders`/`current_database=orders`. Redis pod `Running`;
  `redis-cli -a <vault password> ping` returned `PONG`. Both credentials
  confirmed sourced from Vault via ExternalSecret, not hardcoded.
- Key decisions: ADR-007, ADR-008.
