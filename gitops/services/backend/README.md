# Backend

Phase 5 (`docs/phases.md`): orders/catalog API, source at `apps/backend/`.
Credentials for Postgres, Redis, RabbitMQ (Phase 6 batch 1), and Kafka
(Phase 6 batch 2) are sourced from Vault via External Secrets Operator
(ESO) into the `backend-credentials` Secret — no credential is ever
written to Git. See `gitops/services/README.md` for why only this service
(not bff/frontend/worker) has Vault wiring, and
`docs/adr/009-plain-manifests-for-app-services.md` for why these are plain
manifests, not a Helm chart.

Two distinct messaging clients live in `apps/backend/src/`:
`rabbitmq.js` (task queue: notifies the worker) and `kafka.js` (immutable
event log: `order-events`, for future consumers like Airflow) — see
`docs/architecture.md`'s "do not blur them" note on RabbitMQ vs Kafka.

## One-time Vault bootstrap (script, not GitOps — see why below)

Same reasoning as `gitops/data/postgres/README.md`: only the root token can
write policies or configure auth roles. This step does NOT write any new
secret data — backend reads the SAME `secret/postgres`, `secret/redis`,
`secret/rabbitmq`, and `secret/kafka` KV paths already bootstrapped by
their own directories (`gitops/data/postgres/README.md`,
`gitops/data/redis/README.md`, `gitops/data/rabbitmq/README.md`,
`gitops/data/kafka/README.md`). It only adds a new policy/role scoped to
this namespace's `vault-auth` ServiceAccount, distinct from
`postgres-read`/`redis-read`/`rabbitmq-read`/`kafka-read` for
least-privilege scoping per role.

Run `scripts/bootstrap-vault.sh` from the repo root **once**, after the
`vault`, `external-secrets`, and this directory's Applications report
`Synced`/`Healthy` (see `docs/adr/010-vault-bootstrap-script.md` and
`docs/adr/022-vault-standalone-file-storage.md`). It writes the
`backend-read` policy and `backend` role along with every other service's
setup in the same run:

```sh
./scripts/bootstrap-vault.sh
```

**After any `vault-0` pod restart**: Vault now persists this setup
(`docs/adr/022-vault-standalone-file-storage.md`) — it only comes back up
sealed. Run `scripts/unseal-vault.sh`, not the bootstrap script:

```sh
./scripts/unseal-vault.sh
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

## Verifying the Phase 6 exit gate ("Order event consumed from both systems")

Placing one order must show up on BOTH RabbitMQ's task queue (consumed by
`worker`) and Kafka's `order-events` log (consumed here with
`kafka-console-consumer.sh`) — the actual Phase 6 exit gate
(`docs/phases.md`). Run this only after `deployment.yaml`'s sync wave "4"
(this file's comment) confirms backend itself is `Synced`/`Healthy`,
meaning it authenticated to both brokers successfully.

1. Confirm both messaging dependencies are healthy first:

   ```sh
   kubectl -n rabbitmq get pod -l app=rabbitmq
   kubectl -n kafka get kafka kafka
   # RabbitMQ pod: Running. Kafka CR STATUS: Ready.
   ```

2. Place an order through the backend (direct port-forward is simplest;
   the full browser flow via frontend/BFF also works, see
   `docs/runbooks/` if present):

   ```sh
   kubectl -n apps port-forward svc/backend 8080:8080 &
   curl -s -X POST http://localhost:8080/orders \
     -H 'Content-Type: application/json' \
     -d '{"productId": 1, "quantity": 1}'
   # {"id":<N>,"productId":1,"quantity":1,"totalCents":...}
   ```

3. Confirm the worker consumed the RabbitMQ task-queue message:

   ```sh
   kubectl -n apps logs deploy/worker --tail=20
   # "order <N>: sending email + invoice (stub) ..." — see
   # gitops/services/worker/README.md.
   ```

4. Confirm the event landed in Kafka's `order-events` topic. `backend`'s
   own `KafkaUser` is producer-only (`Describe`+`Write` ACLs only, per
   `gitops/data/kafka/user.yaml` and ADR-012's least-privilege intent — it
   CANNOT consume, and will fail with `GroupAuthorizationException` if
   tried). Use the dedicated read-only `gate-verifier` `KafkaUser` instead
   (`gitops/data/kafka/gate-verifier-user.yaml`,
   `docs/adr/015-kafka-gate-verifier-user.md`) — a debug-only identity
   whose password Strimzi generates and owns itself (not Vault-sourced).
   Run a disposable consumer pod using the exact Strimzi/Kafka version
   pinned in `gitops/data/kafka/cluster.yaml` (`1.1.0-kafka-4.3.0` —
   `strimzi-kafka-operator` chart version 1.1.0, Kafka 4.3.0) — command
   shape confirmed against
   https://strimzi.io/quickstarts/ (kafka-console-consumer.sh invocation)
   and https://strimzi.io/docs/operators/latest/configuring.html
   (SASL_PLAINTEXT + SCRAM-SHA-512 client config via `--consumer-property`):

   ```sh
   GATE_VERIFIER_PASSWORD=$(kubectl -n kafka get secret gate-verifier \
     -o jsonpath='{.data.password}' | base64 -d)

   kubectl -n kafka run kafka-consumer -ti --rm=true --restart=Never \
     --image=quay.io/strimzi/kafka:1.1.0-kafka-4.3.0 -- \
     bin/kafka-console-consumer.sh \
     --bootstrap-server kafka-kafka-bootstrap:9092 \
     --topic order-events \
     --from-beginning \
     --group gate-verifier \
     --consumer-property security.protocol=SASL_PLAINTEXT \
     --consumer-property sasl.mechanism=SCRAM-SHA-512 \
     --consumer-property "sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username=\"gate-verifier\" password=\"${GATE_VERIFIER_PASSWORD}\";"
   # {"type":"order.created","order":{"id":<N>,"productId":1,"quantity":1,"totalCents":...}}
   ```

   Ctrl+C to stop (the pod is `--rm`, so it cleans itself up). If nothing
   prints, re-check step 1's Kafka health and `kubectl -n apps logs
   deploy/backend` for a Kafka auth error — this is exactly the deadlock
   this file's sync-wave "4" comment and `docs/adr/012` guard against.
