# Secrets demo: Vault -> External Secrets Operator -> pod env var

Proves Phase 3's exit gate (`docs/phases.md`): a test secret flows from
Vault, through External Secrets Operator (ESO), into a Kubernetes `Secret`,
consumed by `secret-consumer`'s environment.

Everything in this directory is plain, declarative manifests reconciled
directly by `root-app` (`gitops/root-app.yaml`, `directory.recurse: true`)
— no separate child Application needed for it, unlike the Helm-chart-based
`vault`/`external-secrets` Applications in `gitops/apps/`.

## One-time Vault bootstrap (manual, not GitOps — see why below)

Vault dev-mode (`gitops/apps/vault.yaml`) starts with no data and no
Kubernetes auth method enabled: both must be configured through Vault's own
API using its root token. This is inherently an imperative, one-time action
against a running Vault process — it cannot be expressed as a Git-declared
manifest without either (a) committing the root token somewhere Argo CD can
read it (forbidden — this repo is public, see `docs/adr/002-public-repo-for-branch-protection.md`),
or (b) building a bootstrap Job that itself needs the same token to
authenticate (same problem, one layer down). Run this once, after both the
`vault` and `external-secrets` Argo CD Applications report `Synced`/`Healthy`:

```sh
# 1. Retrieve the dev-mode root token from the pod's own startup log.
#    Never paste this value into any file that gets committed.
kubectl -n vault logs vault-0 | grep 'Root Token'

# 2. Log in inside the pod (token stays in the pod's ephemeral filesystem,
#    never touches your shell history file or this repo).
kubectl -n vault exec -it vault-0 -- vault login   # paste the token when prompted

# 3. Write the test secret (kv-v2, auto-mounted at "secret/" in dev mode).
#    Placeholder value only — never a real credential.
kubectl -n vault exec vault-0 -- vault kv put secret/test-secret key=test-value-not-real

# 4. Enable and configure the Kubernetes auth method.
kubectl -n vault exec vault-0 -- vault auth enable kubernetes
kubectl -n vault exec vault-0 -- vault write auth/kubernetes/config \
  kubernetes_host="https://kubernetes.default.svc:443"

# 5. Policy: read-only access to the one test path.
kubectl -n vault exec -i vault-0 -- vault policy write eso-read - <<'EOF'
path "secret/data/test-secret" {
  capabilities = ["read"]
}
EOF

# 6. Role: binds the policy to the `vault-auth` ServiceAccount in
#    `secrets-demo`, matching secretstore.yaml's serviceAccountRef/audience.
kubectl -n vault exec vault-0 -- vault write auth/kubernetes/role/eso \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=secrets-demo \
  audience=vault \
  policies=eso-read \
  ttl=1h
```

Docs consulted: https://developer.hashicorp.com/vault/docs/auth/kubernetes
(auth method enable/config/role), https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2
(kv-v2 read/write paths).

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
