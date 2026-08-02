# PostgreSQL (CloudNativePG)

Phase 4 (`docs/phases.md`): a single-instance PostgreSQL `Cluster`, managed
by the CloudNativePG operator (`gitops/apps/cloudnativepg-operator.yaml`),
credentials sourced from Vault via External Secrets Operator (ESO) — no
credential ever written to Git. See
`docs/adr/008-postgres-operator-proportionality.md` for why the operator
was chosen.

## One-time Vault bootstrap (manual, not GitOps — see why below)

Same reasoning as `gitops/secrets-demo/README.md`: Vault dev-mode
(`gitops/apps/vault.yaml`) starts empty on every restart, and only the
root token can write data or configure the Kubernetes auth method — an
inherently imperative, one-time action that cannot be Git-declared without
committing the root token (forbidden, this repo is public per
`docs/adr/002-public-repo-for-branch-protection.md`). Run this once, after
the `vault`, `external-secrets`, and `cloudnativepg-operator` Argo CD
Applications report `Synced`/`Healthy`, and again after every Vault pod
restart (see `docs/adr/006-vault-dev-mode-for-lab.md`):

```sh
# 1. Retrieve the dev-mode root token from the pod's own startup log.
kubectl -n vault logs vault-0 | grep 'Root Token'

# 2. Log in inside the pod.
kubectl -n vault exec -it vault-0 -- vault login   # paste the token when prompted

# 3. Write the Postgres app-user credentials (kv-v2, auto-mounted at
#    "secret/" in dev mode). "orders" MUST match cluster.yaml's
#    `spec.bootstrap.initdb.owner` — CloudNativePG requires this match.
#    Use a real generated password here, not this placeholder.
kubectl -n vault exec vault-0 -- vault kv put secret/postgres \
  username=orders \
  password=<generate-a-real-password>

# 4. Policy: read-only access to the one Postgres path.
kubectl -n vault exec -i vault-0 -- vault policy write postgres-read - <<'EOF'
path "secret/data/postgres" {
  capabilities = ["read"]
}
EOF

# 5. Role: binds the policy to the `vault-auth` ServiceAccount in
#    `postgres`, matching secretstore.yaml's serviceAccountRef/audience.
kubectl -n vault exec vault-0 -- vault write auth/kubernetes/role/postgres \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=postgres \
  audience=vault \
  policies=postgres-read \
  ttl=1h
```

Docs consulted: https://developer.hashicorp.com/vault/docs/auth/kubernetes
(auth method role), https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2
(kv-v2 write).

## Verifying the exit gate

```sh
kubectl -n postgres get externalsecret postgres-app-credentials
# SecretSynced condition, no errors.

kubectl -n postgres get cluster postgres
# STATUS: Cluster in healthy state, INSTANCES: 1, READY: 1.

kubectl -n postgres get pod -l cnpg.io/cluster=postgres
# 1 pod, Running.

kubectl -n postgres exec -it postgres-1 -- psql -U orders -d orders -c 'SELECT 1;'
# Confirms the app user/database bootstrapped from the Vault-sourced
# secret. Do not paste any credential value into TASKS.md, commit
# messages, or any other committed file.
```
