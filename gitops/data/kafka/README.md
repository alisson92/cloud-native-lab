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
# Both: STATUS Ready (True).
```

The full Phase 6 exit gate ("Order event consumed from both systems",
`docs/phases.md`) is verified end-to-end once the backend's Kafka producer
(`apps/backend/src/kafka.js`, `gitops/services/backend/`) is also deployed:
placing an order produces a message to `order-events`, confirmed by
consuming it (e.g. `kubectl -n kafka run kafka-consumer --rm -it
--image=... -- bin/kafka-console-consumer.sh ...`, documented once Phase 7's
Airflow consumer lands).
