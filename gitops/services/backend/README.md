# Backend

Phase 5 (`docs/phases.md`): orders/catalog API, source at `apps/backend/`.
Credentials for Postgres and Redis are sourced from Vault via External
Secrets Operator (ESO) into the `backend-credentials` Secret — no credential
is ever written to Git. See `gitops/services/README.md` for why only this
service (not bff/frontend/worker) has Vault wiring, and
`docs/adr/009-plain-manifests-for-app-services.md` for why these are plain
manifests, not a Helm chart.

## One-time Vault bootstrap (script, not GitOps — see why below)

Same reasoning as `gitops/data/postgres/README.md`: Vault dev-mode
(`gitops/apps/vault.yaml`) starts empty on every restart, and only the root
token can write policies or configure auth roles. This step does NOT write
any new secret data — backend reads the SAME `secret/postgres` and
`secret/redis` KV paths already bootstrapped for Phase 4
(`gitops/data/postgres/README.md`, `gitops/data/redis/README.md`). It only
adds a new policy/role scoped to this namespace's `vault-auth`
ServiceAccount, distinct from `postgres-read`/`redis-read` for
least-privilege scoping per role.

Run `scripts/bootstrap-vault.sh` from the repo root once, after the
`vault`, `external-secrets`, and this directory's Applications report
`Synced`/`Healthy`, and again after every Vault pod restart (see
`docs/adr/006-vault-dev-mode-for-lab.md` and
`docs/adr/010-vault-bootstrap-script.md`). It writes the `backend-read`
policy and `backend` role along with secrets-demo/Postgres/Redis's setup in
the same run:

```sh
./scripts/bootstrap-vault.sh
```

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
