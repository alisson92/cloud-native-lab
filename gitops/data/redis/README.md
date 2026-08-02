# Redis

Phase 4 (`docs/phases.md`): a single-replica Redis Deployment (catalog
cache/sessions, `docs/vision.md`), password sourced from Vault via External
Secrets Operator (ESO) — no credential ever written to Git. See
`docs/adr/007-redis-plain-deployment.md` for why a plain Deployment (not an
operator) was chosen.

## One-time Vault bootstrap (manual, not GitOps — see why below)

Same reasoning as `gitops/secrets-demo/README.md`: Vault dev-mode
(`gitops/apps/vault.yaml`) starts empty on every restart, and only the
root token can write data or configure the Kubernetes auth method. Run this
once, after the `vault` and `external-secrets` Argo CD Applications report
`Synced`/`Healthy`, and again after every Vault pod restart (see
`docs/adr/006-vault-dev-mode-for-lab.md`):

```sh
# 1. Retrieve the dev-mode root token from the pod's own startup log.
kubectl -n vault logs vault-0 | grep 'Root Token'

# 2. Log in inside the pod.
kubectl -n vault exec -it vault-0 -- vault login   # paste the token when prompted

# 3. Write the Redis password (kv-v2, auto-mounted at "secret/" in dev
#    mode). Use a real generated password here, not this placeholder.
kubectl -n vault exec vault-0 -- vault kv put secret/redis \
  password=<generate-a-real-password>

# 4. Policy: read-only access to the one Redis path.
kubectl -n vault exec -i vault-0 -- vault policy write redis-read - <<'EOF'
path "secret/data/redis" {
  capabilities = ["read"]
}
EOF

# 5. Role: binds the policy to the `vault-auth` ServiceAccount in `redis`,
#    matching secretstore.yaml's serviceAccountRef/audience.
kubectl -n vault exec vault-0 -- vault write auth/kubernetes/role/redis \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=redis \
  audience=vault \
  policies=redis-read \
  ttl=1h
```

Docs consulted: https://developer.hashicorp.com/vault/docs/auth/kubernetes
(auth method role), https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2
(kv-v2 write).

## Verifying the exit gate

```sh
kubectl -n redis get externalsecret redis-credentials
# SecretSynced condition, no errors.

kubectl -n redis get pod -l app=redis
# Deployment: 1/1 Ready (readinessProbe passing means AUTH against the
# Vault-sourced password succeeded).

kubectl -n redis exec deploy/redis -- redis-cli -a "$(kubectl -n redis get secret redis-credentials -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)" ping
# Confirms PONG locally in your terminal only. Do not paste any credential
# value into TASKS.md, commit messages, or any other committed file.
```
