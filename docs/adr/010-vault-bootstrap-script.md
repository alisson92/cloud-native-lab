# ADR-010: Idempotent bootstrap script for Vault dev-mode state, not a mode switch

- Status: accepted
- Date: 2026-08-02
- Author: security-engineer

## Context

ADR-006 chose Vault dev mode for this lab. Its documented cost — "all
secrets are lost on every pod restart, including the Kubernetes-auth
role/policy and the test KV value" — already happened once in Phase 5: it
silently broke the working Postgres/Redis/backend secret flow from Phases
3-4 until a human noticed and manually re-ran the bootstrap. Verified
against developer.hashicorp.com/vault/docs/concepts/dev-server: dev mode
stores "All data ... (encrypted) in-memory" and "will lose all data on
every restart" — this is not limited to KV values; the Kubernetes auth
method itself (`vault auth enable kubernetes` and its config) is lost too,
so every restart requires redoing the *entire* one-time setup, not just
re-seeding KV data.

By the start of Phase 6, this manual ritual was duplicated across 4
READMEs (`gitops/secrets-demo/`, `gitops/data/postgres/`,
`gitops/data/redis/`, `gitops/services/backend/`), each requiring a human
to grab the root token from `vault-0`'s pod logs and hand-run `vault kv
put` / `vault policy write` / `vault write auth/kubernetes/role/...`.
Phase 6 (messaging) would have added a 5th and 6th copy. Per
`docs/phases.md`'s rule ("if a phase reveals a flaw in a previous phase,
fix the previous phase first"), this needed fixing before Phase 6 work.

### Alternatives considered

1. **Idempotent bootstrap script** (`scripts/bootstrap-vault.sh`): re-runs
   all Vault-side setup (auth method, policies, roles, KV writes) in one
   command, safe to run repeatedly. Root token is read from the pod's own
   log for the single run and never persisted.
2. **Switch Vault to `standalone` mode with a local PVC on Kind**, as a
   partial supersession of ADR-006. Verified: Kind does ship
   `local-path-provisioner` with a default StorageClass out of the box
   (kind.sigs.k8s.io/docs/user/storage/), so `server.dataStorage` in the
   official Vault Helm chart (developer.hashicorp.com/vault/docs/platform/
   k8s/helm/configuration#dataStorage) would work without touching
   `local/kind/kind-config.yaml`. But standalone mode uses the default
   Shamir seal (developer.hashicorp.com/vault/docs/concepts/seal): the
   first start requires `vault operator init`, which returns unseal key
   shares AND a root token that must be captured and stored somewhere;
   every subsequent restart requires `vault operator unseal` with enough
   key shares to meet the threshold before Vault serves any request. This
   lab has no auto-unseal mechanism (e.g. GCP Cloud KMS) configured or in
   scope (ADR-006 already excludes HA/auto-unseal as production-only
   hardening) — hand-managing unseal key shares safely, without landing
   them in this public Git repo (ADR-002), is *the same unsolved
   credential-custody problem* the root token already has under dev mode.
   Standalone mode does not remove that problem; it adds a second instance
   of it (unseal keys) on top of the first (root token), while trading
   "redo Kubernetes-auth setup + reseed KV after every restart" for "type
   in unseal key shares after every restart". Neither operational cost
   disappears without a KMS this lab does not have.

## Decision

Keep Vault in dev mode (ADR-006 stands, not superseded). Add
`scripts/bootstrap-vault.sh`: a single idempotent script that retrieves the
root token from `vault-0`'s pod log
(`kubectl -n vault logs vault-0 | grep 'Root Token'`), then re-applies all
6 Kubernetes-auth roles/policies and KV writes (secrets-demo, postgres,
redis, backend) that used to be 4 separate manual README procedures.
Postgres/Redis passwords are generated once and cached in a local,
`.gitignore`'d directory (`.vault-bootstrap-cache/`) so reruns after a
Vault restart write back the *same* password an already-running
Postgres/Redis instance (backed by its own PVC, unaffected by a Vault
restart) still expects, instead of rotating it out from under the
workload. The root token is never written to any file, Kubernetes Secret,
or this repository — it lives only in the script's process memory for the
duration of one run (`trap` unsets it on exit, per this project's script
conventions in `CLAUDE.md`).

The 4 existing READMEs are updated to point at this script instead of
duplicating the manual `vault kv put`/`policy write`/`auth ... role write`
commands.

## Consequences

Easier: one command to run after any Vault pod restart, instead of
remembering (and hand-typing) 4-6 near-identical procedures; adding Phase
6's RabbitMQ/Kafka roles is a small addition to one file, not a 5th/6th
README section; idempotent by construction, so it is also safe to run
speculatively any time secret flow looks broken, without first diagnosing
whether Vault actually restarted.

Harder: nothing structurally new — the script does not remove the
underlying "dev mode loses everything" limitation (ADR-006's accepted
trade-off), it only makes recovering from it a single command instead of a
multi-step manual ritual. A human (or a future automated health check)
still has to notice the ExternalSecret/pod failures and *decide* to run
it; this ADR does not add automatic detection.

Deferred, not solved (status at the time this ADR was written): this ADR
confirmed — rather than removed — that switching to standalone/HA mode was
blocked on this lab having no auto-unseal mechanism, and deferred the
question to "a future phase adds one (e.g. GCP Cloud KMS)".

**Revisited in `docs/adr/022-vault-standalone-file-storage.md`, without
adding a KMS.** After 4 separate dev-mode data-loss incidents (Phases
3/5/6/7), the question was reopened on a narrower basis: accept manual
unseal after every restart as a permanent trade-off (not something to
avoid via KMS), and use standalone + file storage only to stop losing the
Kubernetes-auth role/policy and KV data, not to remove the unseal step.
**Outcome: ADR-022 supersedes this ADR's rejection.** Vault now runs in
standalone mode with the `file` backend; `scripts/bootstrap-vault.sh` is
trimmed to a true one-time init (it used to redo everything on every
restart); a new `scripts/unseal-vault.sh` handles the now-routine
post-restart unseal. See ADR-022 for how the unseal-key/root-token custody
question — real, and not fully solved even now — was assessed and judged
acceptable at this lab's single-operator, single-Kind-cluster scale.
