# Phase 3 log — Secrets (archived)

> Full coordination log for Phase 3, moved out of `TASKS.md` to keep the
> board lean (see "Token discipline" in `CLAUDE.md`). This file is
> historical record only — agents do not need to read it unless a task
> explicitly requires Phase 3 archaeology. The durable technical record
> lives in commits, PR #6/#7/#8, `docs/adr/006-vault-dev-mode-for-lab.md`,
> and `gitops/secrets-demo/README.md`.

## Outcome summary

- Vault (dev-mode, HashiCorp chart 0.34.0) + External Secrets Operator
  (chart 2.8.0) deployed via GitOps (`gitops/apps/vault.yaml`,
  `gitops/apps/external-secrets.yaml`), reconciled by `root-app`'s
  directory recursion.
- Test flow wired in `gitops/secrets-demo/`: `SecretStore` (Vault backend,
  Kubernetes auth method, no static token ever stored), `ExternalSecret`,
  `secret-consumer` Deployment consuming the synced `Secret` as an env var.
- ADR-006 documents the dev-mode choice and its accepted production gap
  (no HA, no auto-unseal, no TLS, no persistence).
- Reviewer APPROVED PR #6 (phase-gate, 1 pass) with 1 should-fix (sync-wave
  ordering) and 2 nits, all folded into a same-branch follow-up commit
  before merge.
- Two additional live bugs surfaced only after merging to `main` and
  reconciling on the real Kind cluster (PRs #7, #8 — see below).
- **Exit gate confirmed live by the human operator**: `vault`,
  `external-secrets`, `root-app` all `Synced`/`Healthy`;
  `ExternalSecret` `SecretSynced`/`Ready`; `secret-consumer` pod `1/1
  Running` with `TEST_VALUE=test-value-not-real` sourced from Vault.

## Full log

- (orchestrator) Read `TASKS.md`, `docs/phases.md`,
  `docs/adr/004-local-first-validation-with-kind.md`. Explored
  `gitops/`, `docs/conventions.md`, `terraform/delivery/`,
  `local/kind/kind-config.yaml`, and `security-engineer`'s scope via an
  Explore agent. Planned a 2-delegation batch (implementation +
  phase-gate review), explicitly briefing the public-repo no-secrets rule
  (ADR-002) before delegating.
- (security-engineer) Implemented the full batch on branch
  `phase-3/vault-eso-secrets-flow`: `gitops/apps/vault.yaml`,
  `gitops/apps/external-secrets.yaml` (both plain Argo CD Applications
  over the official Helm charts, resource requests/limits set explicitly
  since chart defaults are empty), `gitops/secrets-demo/` (namespace,
  `vault-auth` ServiceAccount, `SecretStore` via Kubernetes auth,
  `ExternalSecret`, `secret-consumer` Deployment), ADR-006. Opened PR #6.
- (reviewer) Phase-gate deep review of PR #6. Verdict: **APPROVED**.
  Independently verified chart versions live against their repos,
  `helm template`-rendered both charts to confirm RBAC/resources/CRD
  API versions, diffed the full PR for secret-shaped content (none
  found, only the placeholder `test-value-not-real`), confirmed zero
  changes to `terraform/`/`local/kind/` (ADR-004 compliance). Findings:
  1 should-fix (no sync-wave ordering between ESO's CRD-installing
  Application and the CRD-dependent CRs in `secrets-demo/`, self-heals
  via retry but avoidable), 2 nits (`TASKS.md` 1 line over budget,
  `secret-consumer` missing `securityContext.runAsNonRoot`).
- (security-engineer) Applied all three findings as a follow-up commit
  on the same branch: `argocd.argoproj.io/sync-wave` annotations (wave
  "0" for `vault`/`external-secrets` Applications, wave "1" for
  `secrets-demo/`), trimmed `TASKS.md`, added
  `securityContext.runAsNonRoot: true` + `runAsUser: 1000` (busybox
  defaults to root, needed an explicit non-root UID).
- (HUMAN) Merged PR #6, deleted the remote branch (later found
  undeleted alongside PR #5's branch — both cleaned up by the
  orchestrator once noticed). Ran the Vault/ESO Applications live on
  Kind.
- **Live bug #1** (found by the human + orchestrator diagnosing
  together): `root-app` stuck retrying — Argo CD schema-validates
  (dry-run) all resources in a sync operation up front, and since ESO's
  CRDs didn't exist yet on first sync, the dry-run for `secrets-demo`'s
  `SecretStore`/`ExternalSecret` failed and aborted the *entire*
  `root-app` sync, including wave "0" (the `vault`/`external-secrets`
  Application objects never got created). Sync-wave ordering doesn't
  prevent this pre-flight validation failure — a known Argo CD rough
  edge for CRD-then-CR patterns in one recursive source.
  (security-engineer) Branch `phase-3/fix-sync-dry-run`: added
  `argocd.argoproj.io/sync-options: SkipDryRunOnMissingResource=true` to
  `secretstore.yaml`/`externalsecret.yaml`, confirmed against the live
  Argo CD sync-options docs. PR #7, merged by HUMAN.
- **Live bug #2**: after PR #7, `external-secrets` Application still
  stuck — `secretstores.external-secrets.io` /
  `clustersecretstores.external-secrets.io` CRDs rejected:
  `metadata.annotations: Too long: may not be more than 262144 bytes`.
  Root cause: those two CRDs embed the OpenAPI schema for every
  supported provider backend, and Argo CD's default client-side apply
  writes the full object into the `kubectl.kubernetes.io/last-applied-
  configuration` annotation, exceeding Kubernetes' 256KiB hard limit.
  (security-engineer) Branch `phase-3/fix-crd-server-side-apply`: added
  `ServerSideApply=true` to `syncPolicy.syncOptions` on the
  `external-secrets` Application (app-wide, not per-resource, per the
  live Argo CD docs — Server-Side Apply avoids the annotation entirely).
  PR #8, merged by HUMAN.
- (orchestrator) Live diagnosis after PR #8 merged, directly against
  the Kind cluster (read-only + Argo CD refresh/terminate-operation
  actions only, no manifest edits outside Git): confirmed CRDs still
  missing after merge; traced it to `root-app` being stuck in an
  in-progress sync operation pinned to a stale manifest snapshot from
  before the fix landed (self-heal skips while "another operation is in
  progress"). Terminated the stuck operation via a `status.operationState.
  phase: Terminating` patch, which let `root-app` pick up the new
  revision and correctly update the `external-secrets` Application
  object. That object's *own* sync was separately stuck in a terminal
  `Failed` state (5 retries exhausted) and Argo CD's self-heal does not
  automatically retry a failed sync for the same chart revision — a
  manual sync trigger was needed. First manual-trigger attempt (a raw
  `kubectl patch` on `.operation.sync`) omitted `syncOptions`, which
  does not inherit from `spec.syncPolicy` when the operation is
  constructed by hand — confirmed via controller logs showing
  `serverSideApply:false` on every applied resource. Corrected the
  patch to include `syncOptions` explicitly; CRDs installed
  successfully on the next attempt (HUMAN ran both patch commands).
- (HUMAN) Ran the one-time Vault bootstrap from
  `gitops/secrets-demo/README.md` (enable + configure
  `auth/kubernetes`, write the `eso-read` policy and `eso` role, seed
  the placeholder secret) directly in their terminal — root token never
  left their session.
- (orchestrator) Diagnosed the remaining `SecretStore`
  `InvalidProviderConfig` (403 on Vault's own `/v1/auth/kubernetes/
  login`, transient — self-resolved once the auth backend's config
  fully propagated) and the `ExternalSecret`'s stale `SecretSyncedError`
  status (hadn't re-reconciled after the `SecretStore` turned `Valid`).
  Nudged reconciliation via the ESO-documented `force-sync` annotation
  (a timestamp bump, not a change to declared state). Confirmed live:
  `SecretStore` `Valid`, `ExternalSecret` `SecretSynced`/`Ready`, `Secret`
  created, `secret-consumer` pod `1/1 Running` with
  `TEST_VALUE=test-value-not-real`. **Phase 3's exit gate in
  `docs/phases.md` is satisfied.**
- (orchestrator) Noticed and fixed two merged-but-undeleted remote
  branches (PR #5 `docs/close-phase-2`, PR #6
  `phase-3/vault-eso-secrets-flow`) at the human's request — all other
  merged PRs in the repo's history had branches correctly deleted;
  isolated lapse, not a pattern.
