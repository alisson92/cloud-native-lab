# PostgreSQL (CloudNativePG)

Phase 4 (`docs/phases.md`): a single-instance PostgreSQL `Cluster`, managed
by the CloudNativePG operator (`gitops/apps/cloudnativepg-operator.yaml`),
credentials sourced from Vault via External Secrets Operator (ESO) — no
credential ever written to Git. See
`docs/adr/008-postgres-operator-proportionality.md` for why the operator
was chosen.

Phase 7 (`docs/phases.md`) adds a second database, "airflow", to this SAME
Cluster (`airflow-database.yaml`, a `spec.managed.roles` entry in
`cluster.yaml`, and `airflow-role-externalsecret.yaml`) instead of a second
CloudNativePG instance — see
`docs/adr/019-airflow-metadata-db-shared-cluster.md` and
`gitops/data/airflow/README.md`.

## One-time Vault bootstrap (script, not GitOps — see why below)

Same reasoning as `gitops/secrets-demo/README.md`: only the root token can
write data or configure the Kubernetes auth method — an inherently
imperative action that cannot be Git-declared without committing the root
token (forbidden, this repo is public per
`docs/adr/002-public-repo-for-branch-protection.md`).

Run `scripts/bootstrap-vault.sh` from the repo root **once**, after the
`vault`, `external-secrets`, and `cloudnativepg-operator` Argo CD
Applications report `Synced`/`Healthy` (see
`docs/adr/010-vault-bootstrap-script.md` and
`docs/adr/022-vault-standalone-file-storage.md`). It writes the Postgres
app-user credentials (`username=orders`, matching `cluster.yaml`'s
`spec.bootstrap.initdb.owner` — CloudNativePG requires this match), the
`postgres-read` policy (extended in Phase 7 to also read
`secret/data/airflow`, for `airflow-role-externalsecret.yaml`), and the
`postgres` role, along with secrets-demo/Redis/backend/airflow's setup in
the same run:

```sh
./scripts/bootstrap-vault.sh
```

The password is generated once and cached locally (gitignored, never
committed) so reruns write back the *same* password the running Postgres
instance already has — see the script's header comment.

**After any `vault-0` pod restart**: Vault now persists this setup (file
storage backend, `docs/adr/022-vault-standalone-file-storage.md`) — it
only comes back up sealed. Run `scripts/unseal-vault.sh`, not the
bootstrap script:

```sh
./scripts/unseal-vault.sh
```

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
