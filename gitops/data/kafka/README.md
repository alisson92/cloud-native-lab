# Kafka (Strimzi)

Phase 6 (`docs/phases.md`): a single-node Kafka cluster in KRaft mode,
managed by the Strimzi Cluster Operator (`gitops/apps/strimzi.yaml`),
credentials sourced from Vault via External Secrets Operator (ESO) — no
credential ever written to Git. See
`docs/adr/012-kafka-strimzi-kraft-and-vault-user.md` for the KRaft trade-off
(moot: this Strimzi version dropped ZooKeeper) and how the `KafkaUser`
credential is made to originate in Vault instead of Strimzi's own generator.

Kafka is an **immutable event log**: order lifecycle events are appended
here and can be replayed by many independent consumers (Airflow, Phase 7).
This is a distinct role from RabbitMQ (`gitops/data/rabbitmq/`, a task
queue whose messages are removed once the worker acknowledges them) — see
`docs/architecture.md`'s integration map. Do not blur the two.

## Layout

- `cluster.yaml` — `KafkaNodePool` (dual-role: controller + broker) and the
  `Kafka` cluster CR itself.
- `topic.yaml` — `KafkaTopic` "order-events".
- `user.yaml` — `KafkaUser` "backend", SCRAM-SHA-512, password sourced from
  the Vault-populated `kafka-app-credentials` Secret (not Strimzi-generated).
- `gate-verifier-user.yaml` — `KafkaUser` "gate-verifier", read-only
  (`Describe`+`Read` on `order-events`, `Read` on consumer group
  "gate-verifier"), Strimzi-generated password (Secret `gate-verifier`,
  NOT Vault-sourced — see `docs/adr/015-kafka-gate-verifier-user.md`). Debug
  identity for manually verifying the Phase 6 exit gate; no workload
  consumes it.
- `secretstore.yaml` / `externalsecret.yaml` / `serviceaccount.yaml` — same
  Vault/ESO Kubernetes-auth pattern as every other directory under
  `gitops/data/`. Not used by `gate-verifier-user.yaml`.

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
`metadata.name` — Strimzi requires this match), the `kafka-read` policy,
and the `kafka` role, along with every other service's setup in the same
run:

```sh
./scripts/bootstrap-vault.sh
```

The password is generated once and cached locally (gitignored, never
committed) so reruns after a Vault restart write back the *same* password
the running `KafkaUser`'s Secret reference already expects.

## Verifying the exit gate

```sh
kubectl -n kafka get externalsecret kafka-app-credentials
# SecretSynced condition, no errors.

kubectl -n kafka get kafka kafka
# STATUS: Ready.

kubectl -n kafka get pod -l strimzi.io/cluster=kafka
# dual-role broker/controller pod, entity-operator pod: both Running.

kubectl -n kafka get kafkatopic order-events
kubectl -n kafka get kafkauser backend
kubectl -n kafka get kafkauser gate-verifier
# All: STATUS Ready (True).
```

The full Phase 6 exit gate ("Order event consumed from both systems",
`docs/phases.md`) is verified end-to-end once the backend's Kafka producer
(`apps/backend/src/kafka.js`, `gitops/services/backend/`) is also deployed:
placing an order produces a message to `order-events`, confirmed by
consuming it with the read-only `gate-verifier` `KafkaUser`
(`gate-verifier-user.yaml`) — `backend`'s own credential cannot consume by
design (producer-only ACLs):

```sh
kubectl -n kafka get kafkauser gate-verifier
# STATUS Ready (True)

kubectl -n kafka get secret gate-verifier -o jsonpath='{.data.password}' | base64 -d
# Strimzi-generated password (this Secret is NOT Vault-sourced; see
# docs/adr/015-kafka-gate-verifier-user.md)

kubectl -n kafka run kafka-consumer-verify --rm -it --restart=Never \
  --image=quay.io/strimzi/kafka:1.1.0-kafka-4.3.0 -- \
  bin/kafka-console-consumer.sh \
  --bootstrap-server kafka-kafka-bootstrap:9092 \
  --topic order-events --from-beginning \
  --group gate-verifier \
  --consumer-property security.protocol=SASL_PLAINTEXT \
  --consumer-property sasl.mechanism=SCRAM-SHA-512 \
  --consumer-property sasl.jaas.config='org.apache.kafka.common.security.scram.ScramLoginModule required username="gate-verifier" password="<password from above>";'
```

This is a throwaway CLI-verification identity, not the real Phase 7
consumer — Phase 7's Airflow ETL gets its own, Vault-sourced `KafkaUser`
following `user.yaml`'s "backend" pattern (a real, long-lived workload
credential), per `docs/adr/015-kafka-gate-verifier-user.md`.
