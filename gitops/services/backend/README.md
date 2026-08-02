# Backend

Phase 5 (`docs/phases.md`): orders/catalog API, source at `apps/backend/`.
Credentials for Postgres and Redis are sourced from Vault via External
Secrets Operator (ESO) into the `backend-credentials` Secret — no credential
is ever written to Git. See `gitops/services/README.md` for why only this
service (not bff/frontend/worker) has Vault wiring, and
`docs/adr/009-plain-manifests-for-app-services.md` for why these are plain
manifests, not a Helm chart.

## One-time Vault bootstrap (manual, not GitOps — see why below)

Same reasoning as `gitops/data/postgres/README.md`: Vault dev-mode
(`gitops/apps/vault.yaml`) starts empty on every restart, and only the root
token can write policies or configure auth roles. This step does NOT write
any new secret data — backend reads the SAME `secret/postgres` and
`secret/redis` KV paths already bootstrapped in Phase 4
(`gitops/data/postgres/README.md`, `gitops/data/redis/README.md`). It only
adds a new policy/role scoped to this namespace's `vault-auth`
ServiceAccount. Run this once, after the `vault` and `external-secrets`
Argo CD Applications and this directory's Applications report
`Synced`/`Healthy`, and again after every Vault pod restart (see
`docs/adr/006-vault-dev-mode-for-lab.md`):

```sh
# 1. Retrieve the dev-mode root token from the pod's own startup log.
kubectl -n vault logs vault-0 | grep 'Root Token'

# 2. Log in inside the pod.
kubectl -n vault exec -it vault-0 -- vault login   # paste the token when prompted

# 3. Policy: read-only access to the two paths backend needs. Distinct from
#    postgres-read/redis-read (Phase 4) since this binds to a different
#    ServiceAccount/namespace, following least-privilege scoping per role.
kubectl -n vault exec -i vault-0 -- vault policy write backend-read - <<'EOF'
path "secret/data/postgres" {
  capabilities = ["read"]
}
path "secret/data/redis" {
  capabilities = ["read"]
}
EOF

# 4. Role: binds the policy to the `vault-auth` ServiceAccount in `apps`,
#    matching secretstore.yaml's serviceAccountRef/audience.
kubectl -n vault exec vault-0 -- vault write auth/kubernetes/role/backend \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=apps \
  audience=vault \
  policies=backend-read \
  ttl=1h
```

Docs consulted: https://developer.hashicorp.com/vault/docs/auth/kubernetes
(auth method role), https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2
(kv-v2 read policy paths).

## Verifying the exit gate

```sh
kubectl -n apps get externalsecret backend-credentials
# SecretSynced condition, no errors.

kubectl -n apps get pod -l app=backend
# Deployment: 1/1 Ready (readinessProbe passing means /health returned 200,
# which requires a successful Postgres schema bootstrap + Redis connect at
# startup, per apps/backend/src/index.js).

kubectl -n apps exec deploy/backend -- wget -qO- http://localhost:8080/health
# {"status":"ok"}
```

Once this, `bff`, and `frontend` are all healthy (`kubectl -n apps get pod`),
the full `docs/phases.md` Phase 5 exit gate ("Order placed end-to-end") is
verified via `kubectl port-forward` against the frontend Service — see
`gitops/services/README.md` and `gitops/services/frontend/service.yaml`'s
comment for the port-forward command.
