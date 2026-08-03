# RabbitMQ

Phase 6 (`docs/phases.md`): a single-replica RabbitMQ Deployment, the task
queue for "order created -> worker sends email/invoice" (`docs/vision.md`).
Credentials sourced from Vault via External Secrets Operator (ESO) — no
credential ever written to Git. See
`docs/adr/011-rabbitmq-plain-deployment.md` for why a plain Deployment (not
an operator) was chosen.

RabbitMQ is a **task queue**: it holds work still to be done (send this
order's email/invoice) and the message is removed once the worker
acknowledges it. This is a distinct role from Kafka (Phase 6 batch 2, an
immutable, replayable event log) — see `docs/architecture.md`'s integration
map. Do not blur the two.

## One-time Vault bootstrap (script, not GitOps — see why below)

Same reasoning as `gitops/data/redis/README.md`: Vault dev-mode
(`gitops/apps/vault.yaml`) starts empty on every restart, and only the
root token can write data or configure the Kubernetes auth method.

Run `scripts/bootstrap-vault.sh` from the repo root once, after the
`vault` and `external-secrets` Argo CD Applications report
`Synced`/`Healthy`, and again after every Vault pod restart (see
`docs/adr/006-vault-dev-mode-for-lab.md` and
`docs/adr/010-vault-bootstrap-script.md`). It writes the RabbitMQ default
user's credentials, the `rabbitmq-read` policy, and the `rabbitmq` role,
along with every other service's setup in the same run:

```sh
./scripts/bootstrap-vault.sh
```

The password is generated once and cached locally (gitignored, never
committed) so reruns after a Vault restart write back the *same* password
the running RabbitMQ instance already has — see the script's header
comment.

## Verifying the exit gate

```sh
kubectl -n rabbitmq get externalsecret rabbitmq-credentials
# SecretSynced condition, no errors.

kubectl -n rabbitmq get pod -l app=rabbitmq
# Deployment: 1/1 Ready (readinessProbe: TCP connect on 5672 succeeds).

kubectl -n rabbitmq logs deploy/rabbitmq | grep -i "Server startup complete"
# Confirms the broker finished booting.
```

The full Phase 6 exit gate ("Order event consumed from both systems",
`docs/phases.md`) is verified end-to-end once the backend/worker wiring
(`gitops/services/backend/`, `gitops/services/worker/`) is also deployed:
placing an order publishes a message here, and the worker's logs show it
was consumed.
