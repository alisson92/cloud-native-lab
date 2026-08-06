# Redis

Phase 4 (`docs/phases.md`): a single-replica Redis Deployment (catalog
cache/sessions, `docs/vision.md`), password sourced from Vault via External
Secrets Operator (ESO) — no credential ever written to Git. See
`docs/adr/007-redis-plain-deployment.md` for why a plain Deployment (not an
operator) was chosen.

## One-time Vault bootstrap (script, not GitOps — see why below)

Same reasoning as `gitops/secrets-demo/README.md`: only the root token can
write data or configure the Kubernetes auth method.

Run `scripts/bootstrap-vault.sh` from the repo root **once**, after the
`vault` and `external-secrets` Argo CD Applications report
`Synced`/`Healthy` (see `docs/adr/010-vault-bootstrap-script.md` and
`docs/adr/022-vault-standalone-file-storage.md`). It writes the Redis
password, the `redis-read` policy, and the `redis` role, along with
secrets-demo/Postgres/backend's setup in the same run:

```sh
./scripts/bootstrap-vault.sh
```

The password is generated once and cached locally (gitignored, never
committed) so reruns write back the *same* password the running Redis
instance already has — see the script's header comment.

**After any `vault-0` pod restart**: Vault now persists this setup
(`docs/adr/022-vault-standalone-file-storage.md`) — it only comes back up
sealed. Run `scripts/unseal-vault.sh`, not the bootstrap script:

```sh
./scripts/unseal-vault.sh
```

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
