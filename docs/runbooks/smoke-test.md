# Runbook — Full-stack smoke test (Phases 1-6)

**Last updated:** 2026-08-03
**Author:** orchestrator (cloud-native-lab)
**Environment:** Kind Dev
**Estimated time:** 15 minutes
**Risk level:** Low

---

## Objective

This runbook validates, end to end, that everything delivered through
Phase 6 (`docs/phases.md`) is healthy on the local Kind cluster: Argo CD's
GitOps reconciliation, Vault + External Secrets Operator, PostgreSQL,
Redis, RabbitMQ, Kafka, and the backend/BFF/frontend/worker application
tier. Run it whenever you need to confirm the environment is in a known-
good state — after restarting the machine or Kind, after a `vault-0`
restart, or before starting a new phase's work.

This is a read-mostly health check plus one functional test (placing one
order). It does not modify any long-lived state beyond that one order row
and its two downstream event-consumption side effects (a stub email/
invoice log line, and one Kafka topic message) — safe to repeat as many
times as needed.

---

## Prerequisites

- [ ] Docker (or the container runtime backing Kind) is running:
      `docker info` succeeds
- [ ] Kind cluster exists and is the current context:
      `kubectl config current-context` returns `kind-cloud-native-lab`
- [ ] `kubectl`, `curl`, and `jq` (optional, for readability) are on `PATH`
- [ ] No other `kubectl port-forward` session is already using local port
      `8080`

---

## ⚠️ Points of attention

- **Vault dev-mode loses all state on every `vault-0` pod restart**
  (`docs/adr/006-vault-dev-mode-for-lab.md`) — not just KV secrets, the
  entire Kubernetes auth method too. If `vault-0` has restarted since the
  last bootstrap (check its `AGE`/`RESTARTS` with
  `kubectl -n vault get pod vault-0`), every `SecretStore` in the cluster
  will fail with `403 permission denied` and every `ExternalSecret` will
  show `SecretSyncedError`. **Always re-run `scripts/bootstrap-vault.sh`
  first if there's any doubt** (step 1) — it is idempotent and safe to
  run even when nothing is broken.
- **A whole-node restart (Kind container itself, or the host machine)
  restarts every pod simultaneously**, including Argo CD's own
  controllers. Right after such a restart, `root-app`'s health can show a
  stale `Degraded` for a few minutes purely from cache warm-up — re-check
  after a couple of minutes before assuming something is actually broken.
  If it stays `Degraded` past that, check `Application`-level resource
  health directly (`argocd app get root-app --core`, not just the
  `Application` CR's own `.status`), since not every resource type
  surfaces per-resource health in the CR's compact status.
- **`root-app` must never be edited to remove itself from its own
  tracked resources without checking `syncPolicy.automated.prune`
  first** — see `docs/adr/014-exclude-root-app-from-self-recursion.md`
  for the incident this caused. Not something this runbook does, but
  worth knowing if `root-app` is ever unexpectedly missing
  (`kubectl -n argocd get application root-app` returns `NotFound`): it
  can be safely recreated with `kubectl apply -f gitops/root-app.yaml`
  (idempotent, same bootstrap-equivalent action as Phase 2).
- **`port-forward` runs in the foreground** — run it in the background
  (`&`) or a separate terminal, and stop it in the cleanup step.

---

## Steps

### 1. Bootstrap Vault (safe to always run)

`scripts/bootstrap-vault.sh` retrieves the dev-mode root token from
`vault-0`'s own startup log, re-enables/reconfigures the Kubernetes auth
method, and re-seeds every KV credential and policy/role pair this repo
depends on. It caches generated passwords, so re-running it does not
rotate credentials that are already in use.

```bash
cd cloud-native-lab
bash scripts/bootstrap-vault.sh
```

**Expected result:** ends with `==> Done. Verify with each directory's
'Verifying the exit gate' section.` and no `Error` lines.

---

### 2. Confirm Argo CD's `root-app` is healthy

```bash
kubectl -n argocd get application root-app \
  -o jsonpath='{.status.sync.status} {.status.health.status}{"\n"}'
```

**Expected result:** `Synced Healthy`

If it shows `Degraded` right after a cluster/node restart, wait ~2
minutes and re-check before troubleshooting further (see Points of
attention above).

---

### 3. Confirm every `SecretStore`/`ExternalSecret` is synced

```bash
for ns in apps postgres redis rabbitmq kafka secrets-demo; do
  echo "=== $ns ==="
  kubectl -n "$ns" get secretstore
  kubectl -n "$ns" get externalsecret
done
```

**Expected result:** every `SecretStore` row shows `READY: True`; every
`ExternalSecret` row shows `STATUS: SecretSynced`, `READY: True`.

---

### 4. Confirm every workload pod is running

```bash
kubectl get pod -A --field-selector=status.phase!=Running,status.phase!=Succeeded
```

**Expected result:** `No resources found` (empty output means nothing is
stuck outside `Running`/`Succeeded`).

```bash
kubectl -n apps get pod
kubectl -n postgres get pod
kubectl -n redis get pod
kubectl -n rabbitmq get pod
kubectl -n kafka get pod
kubectl -n secrets-demo get pod
```

**Expected result:** `backend`, `bff`, `frontend`, `worker` (namespace
`apps`); `postgres-1` (namespace `postgres`); `redis-*` (namespace
`redis`); `rabbitmq-*` (namespace `rabbitmq`); `kafka-dual-role-0` +
`kafka-entity-operator-*` + `strimzi-cluster-operator-*` (namespace
`kafka`); `secret-consumer-*` (namespace `secrets-demo`) — all `1/1`
(or `2/2` for the entity operator) `Running`.

---

### 5. Confirm Kafka's cluster and identities are ready

```bash
kubectl -n kafka get kafka kafka
kubectl -n kafka get kafkauser backend gate-verifier
kubectl -n kafka get kafkatopic order-events
```

**Expected result:** all rows show `READY: True`.

---

### 6. Place an order and confirm RabbitMQ consumption

```bash
kubectl -n apps port-forward svc/backend 8080:8080 >/tmp/smoke-test-pf.log 2>&1 &
sleep 3

curl -s -X POST http://localhost:8080/orders \
  -H 'Content-Type: application/json' \
  -d '{"productId": 1, "quantity": 1}'
```

**Expected result:** a JSON body like
`{"id":<N>,"productId":1,"quantity":1,"totalCents":1299}`. Note the
`<N>` order id for the next steps.

```bash
sleep 3
kubectl -n apps logs deploy/worker --tail=10
```

**Expected result:** a line reading
`order <N>: sending email + invoice (stub) — total <cents> cents` — this
confirms the RabbitMQ task queue delivered the message and the worker
consumed it.

---

### 7. Confirm Kafka consumption

Uses the `gate-verifier` `KafkaUser` (`gitops/data/kafka/gate-verifier-user.yaml`)
— a dedicated read-only identity scoped to `order-events`, created
specifically for this kind of ad-hoc verification (see
`docs/adr/015-kafka-gate-verifier-user.md`). It does not have write
access, and the `backend` service account is intentionally *not* used
here since it is producer-only.

```bash
GATE_PASSWORD=$(kubectl -n kafka get secret gate-verifier \
  -o jsonpath='{.data.password}' | base64 -d)

kubectl -n kafka delete pod kafka-consumer --ignore-not-found=true --wait=true >/dev/null 2>&1

kubectl -n kafka run kafka-consumer --restart=Never \
  --image=quay.io/strimzi/kafka:1.1.0-kafka-4.3.0 -- \
  bin/kafka-console-consumer.sh \
  --bootstrap-server kafka-kafka-bootstrap:9092 \
  --topic order-events \
  --from-beginning \
  --timeout-ms 15000 \
  --group gate-verifier \
  --consumer-property security.protocol=SASL_PLAINTEXT \
  --consumer-property sasl.mechanism=SCRAM-SHA-512 \
  --consumer-property "sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username=\"gate-verifier\" password=\"${GATE_PASSWORD}\";"

sleep 20
kubectl -n kafka logs kafka-consumer
kubectl -n kafka delete pod kafka-consumer --ignore-not-found=true
```

**Expected result:** one JSON line per order ever placed since the
topic's retention started, including the order from step 6, e.g.
`{"type":"order.created","order":{"id":<N>,"productId":1,"quantity":1,"totalCents":1299}}`.

> ⚠️ **Not an error:** the log output will also show a line like
> `[ERROR] Error processing message, terminating consumer process:
> org.apache.kafka.common.errors.TimeoutException`, right after the
> JSON message(s) and before `Processed a total of N messages`. This is
> the intended, documented exit mechanism for `--timeout-ms`, not a
> consumption failure. Per Apache Kafka's own tool source, the flag's
> help text reads: *"If specified, exit if no message is available for
> consumption for the specified interval"* — `--timeout-ms 15000` means
> "if 15 seconds pass with no new message, exit," and it throws a
> `TimeoutException` (logged at `ERROR` level) to do so once no more
> messages are pending. As long as `Processed a total of N messages`
> shows `N >= 1` and the expected JSON line(s) appeared above it, the
> test succeeded.
> ([`ConsoleConsumerOptions.java`, `apache/kafka`](https://github.com/apache/kafka/blob/trunk/tools/src/main/java/org/apache/kafka/tools/consumer/ConsoleConsumerOptions.java);
> also tracked as a known logging-level quirk in
> [KAFKA-8789](https://issues.apache.org/jira/browse/KAFKA-8789).)

---

### 8. Cleanup

```bash
kill %1 2>/dev/null  # stops the port-forward started in step 6
```

**Success criterion (all of the above):**
- [ ] `root-app` `Synced`/`Healthy`
- [ ] Every `SecretStore`/`ExternalSecret` synced
- [ ] Every pod `Running`
- [ ] `Kafka`, `backend` and `gate-verifier` `KafkaUser`s, and
      `order-events` topic all `Ready`
- [ ] Order placed successfully via `curl`
- [ ] Worker log shows the order consumed from RabbitMQ
- [ ] Kafka consumer prints the order event from `order-events`

---

## Rollback

Not applicable — this runbook is non-destructive. The one artifact it
creates (an `orders` row and its two event-consumption side effects) does
not need to be reverted; it is normal application data, safe to leave in
place.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `SecretSyncedError` on any `ExternalSecret`, `403 permission denied` in `external-secrets` logs | Vault dev-mode lost its Kubernetes auth method (pod restart) | Re-run `bash scripts/bootstrap-vault.sh` (step 1) |
| `root-app` `NotFound` | `root-app` Application object was pruned (see ADR-014) | `kubectl apply -f gitops/root-app.yaml` |
| `root-app` stuck `Degraded` for several minutes with every child resource actually healthy | Argo CD controller cache cold after a node/pod restart | Wait, then check `argocd app get root-app --core` for real per-resource health instead of the `Application` CR's summary |
| `KafkaUser` not `Ready`, error mentions "authorization ACL rules ... not supported" | `Kafka` CR missing `spec.kafka.authorization` (should already be fixed — PR #28) | Confirm `gitops/data/kafka/cluster.yaml` has `authorization: {type: simple}`; if reverted, restore it |
| Kafka consumer fails with `GroupAuthorizationException` | Consuming with the `backend` identity, which is producer-only by design | Use `gate-verifier`'s credentials instead (step 7), never `backend`'s |
| Kafka consumer fails with `SaslAuthenticationException` | `KafkaUser` reconcile never completed (see prior row), or wrong password fetched | Re-check `kafkauser` status; re-fetch the password from the correct `Secret` |
| `curl` to `/orders` hangs or connection-refused | `port-forward` not established, or `backend` pod not `Running`/`Ready` | `kubectl -n apps get pod`, `kubectl -n apps logs deploy/backend` |
| Kafka consumer log ends with `[ERROR] ... TimeoutException` after printing the expected JSON message(s) | **Not an error** — `--timeout-ms`'s documented exit mechanism firing after 15s of no new messages (see step 7's note) | None — check `Processed a total of N messages` shows `N >= 1` and move on |

---

## References

- `docs/phases.md` — phase definitions and exit gates
- `docs/phase-logs/phase-6.md` — full Phase 6 log, including every
  live-only bug this runbook's checks were designed to catch
- `docs/adr/006-vault-dev-mode-for-lab.md` — why Vault loses state on
  restart
- `docs/adr/012-kafka-strimzi-kraft-and-vault-user.md`,
  `docs/adr/015-kafka-gate-verifier-user.md` — Kafka authentication/
  authorization design
- `docs/adr/014-exclude-root-app-from-self-recursion.md` — the
  `root-app` self-deletion incident and recovery
- `docs/runbooks/browser-order-flow-walkthrough.md` — the same order
  flow, driven through the browser instead of `curl`
