# Kafka (Strimzi)

Phase 6 (`docs/phases.md`): a single-node Kafka cluster in KRaft mode,
managed by the Strimzi Cluster Operator (`gitops/apps/strimzi.yaml`),
credentials sourced from Vault via External Secrets Operator (ESO) — no
credential ever written to Git. See
`docs/adr/012-kafka-strimzi-kraft-and-vault-user.md` for the KRaft trade-off
(moot: this Strimzi version dropped ZooKeeper) and how the `KafkaUser`
credential is made to originate in Vault instead of Strimzi's own generator.

Kafka is an **immutable event log**: order lifecycle events are appended
here and can be replayed by many independent consumers. This is a distinct
role from RabbitMQ (`gitops/data/rabbitmq/`, a task queue whose messages
are removed once the worker acknowledges them) — see
`docs/architecture.md`'s integration map. Do not blur the two.

## Layout

- `cluster.yaml` — `KafkaNodePool` (dual-role: controller + broker) and the
  `Kafka` cluster CR itself.
- `topic.yaml` — `KafkaTopic` "order-events".
- `user.yaml` — `KafkaUser` "backend" (producer, `Describe`+`Write`),
  password sourced from the Vault-populated `kafka-app-credentials`
  Secret (not Strimzi-generated).
- `airflow-user.yaml` / `airflow-user-externalsecret.yaml` (Phase 7) —
  `KafkaUser` "airflow", read-only (`Describe`+`Read` on `order-events`,
  `Read` on consumer group "airflow-sales-report"), password sourced from
  Vault path `secret/airflow-kafka` — the real, long-lived Phase 7 ETL
  consumer this repo's own `docs/adr/015-kafka-gate-verifier-user.md`
  anticipated. Replaces the Phase 6 `gate-verifier` `KafkaUser` (removed:
  ADR-015's own accepted trade-off — "should be deleted once Phase 7's
  real consumer makes it redundant for gate verification"; its
  Phase-6-only verification steps are preserved in
  `docs/phase-logs/phase-6.md`, not repeated here).
- `secretstore.yaml` / `externalsecret.yaml` / `serviceaccount.yaml` — same
  Vault/ESO Kubernetes-auth pattern as every other directory under
  `gitops/data/`.

## One-time Vault bootstrap (script, not GitOps — see why below)

Same reasoning as `gitops/data/postgres/README.md`: Vault dev-mode
(`gitops/apps/vault.yaml`) starts empty on every restart, and only the
root token can write data or configure the Kubernetes auth method.

Run `scripts/bootstrap-vault.sh` from the repo root once, after the
`strimzi` and `external-secrets` Argo CD Applications report
`Synced`/`Healthy`, and again after every Vault pod restart (see
`docs/adr/006-vault-dev-mode-for-lab.md` and
`docs/adr/010-vault-bootstrap-script.md`). It writes the "backend" Kafka
user's credentials (`username=backend`, matching `user.yaml`'s
`metadata.name` — Strimzi requires this match), the "airflow" Kafka user's
credentials (`secret/airflow-kafka`, matching `airflow-user.yaml`'s
`metadata.name`), the `kafka-read` policy (covering both paths), and the
`kafka` role, along with every other service's setup in the same run:

```sh
./scripts/bootstrap-vault.sh
```

The password is generated once and cached locally (gitignored, never
committed) so reruns after a Vault restart write back the *same* password
the running `KafkaUser`'s Secret reference already expects.

## Verifying the exit gate

```sh
kubectl -n kafka get externalsecret kafka-app-credentials airflow-kafka-credentials
# Both SecretSynced, no errors.

kubectl -n kafka get kafka kafka
# STATUS: Ready.

kubectl -n kafka get pod -l strimzi.io/cluster=kafka
# dual-role broker/controller pod, entity-operator pod: both Running.

kubectl -n kafka get kafkatopic order-events
kubectl -n kafka get kafkauser backend airflow
# All: STATUS Ready (True).
```

The Phase 7 exit gate ("Nightly DAG produces a report", `docs/phases.md`)
is verified via `gitops/data/airflow/README.md` — the "airflow" `KafkaUser`
declared here is what Airflow's `sales_report` DAG authenticates as to
consume `order-events`.
