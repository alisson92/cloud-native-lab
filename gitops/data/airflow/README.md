# Airflow (Phase 7)

Nightly batch ETL (`docs/vision.md`: "Airflow | Nightly batch ETL:
aggregate events into sales reports"), deployed via the official Helm
chart (`gitops/apps/airflow.yaml`), credentials sourced from Vault via
External Secrets Operator (ESO) — no credential ever written to Git. See:

- `docs/adr/017-airflow-local-executor.md` — executor choice
- `docs/adr/018-airflow-dag-configmap-delivery.md` — DAG delivery mechanism
- `docs/adr/019-airflow-metadata-db-shared-cluster.md` — metadata DB reuse
- `docs/adr/020-airflow-kafka-postgres-source-split.md` — data-source split

## Layout

- `namespace.yaml` / `serviceaccount.yaml` / `secretstore.yaml` — same
  Vault/ESO Kubernetes-auth pattern as every other `gitops/data/*`
  directory.
- `externalsecret-metadata-db.yaml` — Airflow's own metadata-database
  connection string (Secret `airflow-metadata-db-credentials`, key
  `connection`), consumed by `gitops/apps/airflow.yaml`'s
  `data.metadataSecretName`.
- `externalsecret-postgres-connection.yaml` — the DAG's read connection to
  the "orders" database (Secret `airflow-postgres-connection`), reusing
  the existing "orders" application credential (`secret/postgres` in
  Vault).
- `externalsecret-kafka-connection.yaml` — the DAG's Kafka consumer
  connection (Secret `airflow-kafka-connection`), backed by the dedicated
  `airflow` `KafkaUser` (`gitops/data/kafka/airflow-user.yaml`).
- `dags-configmap.yaml` — the sales-report DAG's single source file
  (`sales_report_dag.py`), mounted into every Airflow pod.

## One-time Vault bootstrap

Same reasoning as every other `gitops/data/*/README.md`: only the root
token can write data or configure the Kubernetes auth method. Run
`scripts/bootstrap-vault.sh` from the repo root **once** the `airflow`,
`external-secrets`, `cloudnativepg-operator`, and `strimzi` Argo CD
Applications report `Synced`/`Healthy`. It writes the "airflow"
metadata-db role credential (`secret/airflow`), the "airflow" Kafka user
credential (`secret/airflow-kafka`), the `airflow-read` policy (also
granted read on `secret/postgres`, reusing the orders app credential), and
the `airflow` Kubernetes-auth role.

**After any `vault-0` pod restart**: Vault now persists this setup
(`docs/adr/022-vault-standalone-file-storage.md`, superseding the
dev-mode data loss `docs/adr/006-vault-dev-mode-for-lab.md` originally
accepted) — it only comes back up sealed. Run `scripts/unseal-vault.sh`,
not the bootstrap script.

## Verifying the exit gate

```sh
kubectl -n airflow get externalsecret
# All SecretSynced, no errors.

kubectl -n airflow get pod
# scheduler, api-server, dag-processor: Running. migrate-database and
# create-user Jobs: Completed.

kubectl -n postgres get database airflow
kubectl -n kafka get kafkauser airflow
# Both: STATUS Ready (True).

# Trigger a run manually rather than waiting for the 02:00 UTC schedule:
kubectl -n airflow exec deploy/airflow-scheduler -- airflow dags trigger sales_report

# After it completes (kubectl -n airflow exec deploy/airflow-scheduler --
# airflow dags list-runs -d sales_report):
kubectl -n postgres exec -it postgres-1 -- psql -U orders -d orders \
  -c 'SELECT * FROM sales_reports ORDER BY generated_at DESC LIMIT 10;'
kubectl -n postgres exec -it postgres-1 -- psql -U orders -d orders \
  -c 'SELECT * FROM kafka_event_counts ORDER BY generated_at DESC LIMIT 10;'
```
