# Secrets demo: Vault -> External Secrets Operator -> pod env var

Proves Phase 3's exit gate (`docs/phases.md`): a test secret flows from
Vault, through External Secrets Operator (ESO), into a Kubernetes `Secret`,
consumed by `secret-consumer`'s environment.

Everything in this directory is plain, declarative manifests reconciled
directly by `root-app` (`gitops/root-app.yaml`, `directory.recurse: true`)
— no separate child Application needed for it, unlike the Helm-chart-based
`vault`/`external-secrets` Applications in `gitops/apps/`.

## One-time Vault bootstrap (script, not GitOps — see why below)

Vault dev-mode (`gitops/apps/vault.yaml`) starts with no data and no
Kubernetes auth method enabled: both must be configured through Vault's own
API using its root token. This is inherently an imperative action against a
running Vault process — it cannot be expressed as a Git-declared manifest
without either (a) committing the root token somewhere Argo CD can read it
(forbidden — this repo is public, see
`docs/adr/002-public-repo-for-branch-protection.md`), or (b) building a
bootstrap Job that itself needs the same token to authenticate (same
problem, one layer down). Worse: dev-mode's in-memory storage means this
setup — including the Kubernetes auth method itself, not just KV data — is
lost on every `vault-0` pod restart (`docs/adr/006-vault-dev-mode-for-lab.md`).

Run `scripts/bootstrap-vault.sh` from the repo root once, after both the
`vault` and `external-secrets` Argo CD Applications report
`Synced`/`Healthy`, and again after any `vault-0` pod restart. It is
idempotent and bootstraps this directory's test secret/policy/role along
with Postgres, Redis, and backend's (see `docs/adr/010-vault-bootstrap-script.md`
for why one script replaced 4 separate manual procedures):

```sh
./scripts/bootstrap-vault.sh
```

## Verifying the exit gate

```sh
kubectl -n secrets-demo get externalsecret test-secret
# SecretStore/ExternalSecret: SecretSynced condition, no errors.

kubectl -n secrets-demo get pod -l app=secret-consumer
# Deployment: 1/1 Ready (readinessProbe passing means the startup env-var
# check succeeded).

kubectl -n secrets-demo exec deploy/secret-consumer -- env | grep TEST_VALUE
# Confirms the live value locally in your terminal only. Do not paste this
# output into TASKS.md, commit messages, or any other committed file.
```
