# ADR-022: Vault standalone mode with file storage (supersedes ADR-006 Decision 1 only)

- Status: accepted
- Date: 2026-08-06
- Author: security-engineer

## Context

ADR-006 chose Vault dev mode for this lab; ADR-010 revisited standalone mode
once (in the middle of the resulting operational pain) and rejected it,
reasoning that unseal-key custody was "the same unsolved credential-custody
problem the root token already has under dev mode." Between Phase 3 and
Phase 7, dev mode's documented cost — "all secrets are lost on every pod
restart" (developer.hashicorp.com/vault/docs/concepts/dev-server) — hit 4
separate times: Phase 3/5 (`docs/phase-logs/phase-3.md`,
`docs/phase-logs/phase-5.md`), Phase 6 (`docs/phase-logs/phase-6.md`, line
70), and Phase 7 (`docs/phase-logs/phase-7.md`, line 36). Each time, a human
had to notice a silent secret-flow failure and re-run
`scripts/bootstrap-vault.sh` to redo all 8 consumers' worth of Kubernetes-auth
roles/policies/KV writes (secrets-demo, postgres, redis, rabbitmq, kafka,
backend, worker, airflow) from scratch.

This ADR re-evaluates *specifically* the option ADR-010 already looked at —
standalone mode with the `file` storage backend on a local PVC — on a
narrower basis than before: **manual unseal after every restart is now an
explicitly accepted trade-off**, not something being avoided. The goal is
only to stop losing the Kubernetes auth method, its roles/policies, and all
KV data on restart; trading "redo everything" for "type in unseal key
shares" is acceptable at this lab's scale. No KMS/auto-unseal is added.

### Verified against official docs

- **File storage backend**
  (developer.hashicorp.com/vault/docs/configuration/storage/filesystem):
  single required `path` config key; does not support HA (irrelevant here,
  this lab has one Vault replica either way); intended for single-server or
  local-dev scenarios — matches this lab exactly.
- **Vault Helm chart values**
  (developer.hashicorp.com/vault/docs/platform/k8s/helm/configuration,
  cross-checked with `helm show values hashicorp/vault --version 0.34.0`
  against `https://helm.releases.hashicorp.com`):
  - `server.standalone.enabled` defaults to the sentinel `"-"`, which
    resolves to standalone mode when neither `dev` nor `ha` are enabled.
    Its default `config` already sets `storage "file" { path =
    "/vault/data" }` and `listener "tcp" { tls_disable = 1 }` — the same
    "no TLS" posture ADR-006 already accepted for dev mode, so switching
    modes does not reopen that trade-off.
  - `server.dataStorage.enabled` defaults to `true`, `size` to `10Gi`,
    `mountPath` to `/vault/data` (matching the `storage "file"` path
    above), `storageClass` to `null` (cluster default StorageClass).
  - Kind ships `local-path-provisioner` as the default StorageClass out of
    the box (kind.sigs.k8s.io/docs/user/storage/, already confirmed once in
    ADR-010) — `storageClass: null` resolves correctly with zero changes to
    `local/kind/kind-config.yaml`.
- **Seal/unseal flow**
  (developer.hashicorp.com/vault/docs/concepts/seal): `vault operator init`
  runs exactly once per Vault storage lifetime and returns Shamir unseal key
  shares (default 5 shares / 3 threshold) plus a root token — neither is
  reproducible afterwards. Every subsequent process restart starts sealed
  and needs `vault operator unseal` run with enough key shares to meet the
  threshold before Vault serves any request; this is unavoidable without an
  auto-unseal mechanism (out of scope this round, per the task).

### The custody question this introduces (new, honestly assessed)

Dev mode never had an unseal-key or durable-root-token custody problem: its
root token was regenerated and printed to `vault-0`'s own ephemeral pod log
on every restart, read once, and discarded — nothing needed to survive a
restart because nothing survived a restart. Standalone + file inverts this:
the unseal key shares and the root token now **must** survive every
restart, because they cannot be regenerated (only `vault operator init`,
run once, ever produces them) and Vault refuses all requests while sealed.
This is new operational weight ADR-006/ADR-010 did not have to carry.

Where do they go? They cannot land in Git (this repo is public, ADR-002;
CLAUDE.md's absolute no-secrets-in-git rule). This ADR's answer: the same
place `scripts/bootstrap-vault.sh` already caches generated Postgres/Redis/
RabbitMQ/Kafka/Airflow passwords — the gitignored `.vault-bootstrap-cache/`
directory on the operator's own machine (`chmod 700` dir, `chmod 600`
files), a trust boundary ADR-010 already established and accepted for other
generated secrets in this lab. This is judged acceptable here, unlike
ADR-010's prior rejection, for three concrete reasons:

1. **Frequency**: `vault operator init` runs once per Vault storage
   lifetime (once per fresh PVC), not once per restart. ADR-010 rejected
   standalone partly by comparing "redo everything" (a repeated cost) against
   "unseal-key custody" as if custody were also a repeated cost; it is not —
   it is a one-time write, then a repeated *read* of an already-solved
   problem.
2. **Blast radius**: single operator, single local Kind cluster, no shared
   team environment (`docs/adr/004-local-first-validation-with-kind.md`) —
   the same proportionality argument that already justifies caching
   Postgres/Redis passwords locally applies unchanged to the unseal keys and
   root token.
3. **No new posture, no new tooling**: this ADR does not introduce a new
   custody mechanism (no password manager, no external KMS/HSM) — it reuses
   the existing local-cache pattern. If that pattern is not trusted enough
   for the unseal keys/root token, it was never trustworthy enough for the
   database passwords already living there either; this ADR does not invent
   a new risk class, it extends an already-accepted one.

## Decision

Switch Vault to **standalone mode with the file storage backend on a local
PVC** (`gitops/apps/vault.yaml`: `server.standalone.enabled: true` +
`server.dataStorage`), using Kind's default `local-path-provisioner`
StorageClass. This supersedes **only** ADR-006's Decision 1 (dev-mode
storage). ADR-006's Decision 2 — the Kubernetes auth method for ESO instead
of a static token — and its reasoning are untouched and remain in force.

`scripts/bootstrap-vault.sh` is trimmed to a **true one-time** procedure: it
now detects an uninitialized Vault, runs `vault operator init`, caches the
unseal keys and root token in `.vault-bootstrap-cache/vault-init.json`
(new; same directory, same trust boundary as the existing cached app
passwords), unseals once, then writes the Kubernetes-auth roles/policies/KV
data exactly as before (this part remains idempotent and safe to re-run,
e.g. if a future phase adds a new consumer). A new script,
`scripts/unseal-vault.sh`, handles the now-routine case: after any
`vault-0` restart, it reads the cached unseal keys and runs `vault operator
unseal` the required number of times — no root token needed for unsealing,
no re-running of the role/policy/KV setup, because the file backend now
persists that across restarts.

All 8 READMEs that referenced `scripts/bootstrap-vault.sh` for
"re-run after every restart"
(`gitops/secrets-demo/README.md`, `gitops/data/postgres/README.md`,
`gitops/data/redis/README.md`, `gitops/data/rabbitmq/README.md`,
`gitops/data/kafka/README.md`, `gitops/services/backend/README.md`,
`gitops/services/worker/README.md`, `gitops/data/airflow/README.md`) plus
the root `README.md`'s "Running it locally" section are updated to point
restart-recovery at `scripts/unseal-vault.sh` instead, keeping
`scripts/bootstrap-vault.sh` for first-time setup (and future new
consumers) only.

## Consequences

**Easier:**
- The 4-incidents-and-counting failure mode (full manual re-bootstrap of 8
  consumers' Kubernetes-auth config after any `vault-0` restart) is gone.
  A restart now needs one command (`scripts/unseal-vault.sh`) instead of
  redoing ~40 `vault write`/`vault policy write`/`vault kv put` calls.
- `.vault-bootstrap-cache/`'s existing cached-password idempotency logic
  keeps working unchanged (still relevant for a full Kind-cluster
  recreation, where Postgres/Redis/etc. also get fresh PVCs and need the
  same password Vault will now durably remember too).

**Harder / accepted trade-offs:**
- Manual unseal after every `vault-0` restart (`vault operator unseal`,
  3 of 5 default Shamir shares) — the trade-off this ADR explicitly accepts
  in exchange for persistence. No auto-unseal/KMS in scope.
- A new durable-secret custody surface did not exist before: the unseal
  keys and root token in `.vault-bootstrap-cache/vault-init.json`. If that
  file or directory is lost (e.g. a fresh machine, a wiped `$HOME`), Vault's
  PVC becomes permanently unrecoverable (Shamir shares are not
  reconstructible without a threshold of them) — the practical mitigation
  is the same ADR-004 already assumes: this Kind cluster and its PVCs are
  themselves ephemeral and can be deleted and reinitialized from GitOps
  alone; nothing outside `.vault-bootstrap-cache/` depends on the lost
  Vault data surviving.
- Still no HA, no TLS, no auto-unseal — unchanged from ADR-006's accepted
  production-hardening gap; none of that is in scope this round.

Before any GKE/production use: ADR-006's original "Consequences" section
already states the requirement (Raft HA + auto-unseal via cloud KMS + TLS)
independently of this ADR; this ADR does not change that guidance, it only
removes dev mode as the interim local posture.
