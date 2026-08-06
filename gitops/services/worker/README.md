# Worker

Phase 6 (`docs/phases.md`): a real RabbitMQ consumer, replacing the Phase 5
placeholder heartbeat loop. `apps/worker/src/index.js` connects to RabbitMQ
and `apps/worker/src/rabbitmq.js` consumes messages from the `orders.created`
queue published by the backend (`docs/vision.md`: "RabbitMQ | Task queue:
order created -> worker sends email/invoice"). Each message is handled by a
stubbed email/invoice log line and manually acknowledged; unparsable
messages are nacked without requeue (see `apps/worker/src/rabbitmq.js`'s
comments — no dead-letter exchange configured in this lab).

Unlike backend, bff, and frontend, worker has its own scoped Vault identity
(`serviceaccount.yaml`, `secretstore.yaml`, `externalsecret.yaml` in this
directory) — see those files' comments for why a distinct ServiceAccount
name (`worker-vault-auth`, not backend's `vault-auth`) is required for the
least-privilege scoping (only `secret/data/rabbitmq`) to actually hold.

## Vault bootstrap

Same one-time bootstrap as every other service in this repo — see
`gitops/data/rabbitmq/README.md`. `scripts/bootstrap-vault.sh` writes the
`worker-read` policy and `worker` role in the same run as RabbitMQ's own KV
credentials. After any `vault-0` pod restart, run `scripts/unseal-vault.sh`
instead (`docs/adr/022-vault-standalone-file-storage.md`) — this setup now
persists, it only needs unsealing.

## Verifying the exit gate

```sh
kubectl -n apps get externalsecret worker-credentials
# SecretSynced condition, no errors.

kubectl -n apps get pod -l app=worker
# Deployment: 1/1 Ready (readinessProbe: /tmp/ready written only after the
# RabbitMQ consumer is up).

kubectl -n apps logs deploy/worker
# "worker: consuming orders.created from RabbitMQ" on startup, then one
# "order <id>: sending email + invoice (stub) ..." line per order placed
# through the backend (gitops/services/backend/README.md).
```
