# Phase 6 — Messaging

Owner: data-engineer. Exit gate (docs/phases.md): order event consumed
from both systems (RabbitMQ + Kafka), verified live on Kind. Reviewer
verdict: **APPROVE WITH FOLLOW-UPS** (all four follow-ups closed before
Phase 7 start — see below).

## Summary

- Batch 1/2 (PR #23, `phase-6/rabbitmq`): RabbitMQ task queue, backend
  publishes on order commit, worker consumes (stub email/invoice).
  Worker's first Vault/ESO wiring, scoped to `secret/data/rabbitmq` only
  via a distinct `worker-vault-auth` SA (deviation from literal
  `vault-auth` naming, for least-privilege). Key decision: ADR-011.
- Batch 2/2 (PR #24, `phase-6/kafka`): Kafka (Strimzi, KRaft),
  `order-events` topic, backend publishes via new `kafka.js`
  (`@confluentinc/kafka-javascript` — kafkajs unmaintained since 2023).
  `KafkaUser` credentialed from Vault (`secret/kafka`). Key decision:
  ADR-012.
- Phase-gate fix on PR #24: backend's unguarded `createKafkaProducer()`
  at startup raced the `KafkaUser` CR (wave 3), deadlocking Argo CD at
  wave 2. Fixed by moving `gitops/services/backend/deployment.yaml` to
  sync-wave "4".
- Tooling (not phase-gating): `bump-gitops` CI job (PR #25, ADR-013)
  automates future image-tag bumps after `push` lands a new image on
  `main` — opens a PR, never merges.

## Live-only bugs found and fixed post-merge

None of these were catchable pre-merge (Vault dev-mode's in-memory state
loss, GHCR/CI timing races, and a documentation-time-only ACL gap all
only surface once Argo CD/Vault/CI run for real):

1. **`SecretStore` name collision** (PR #26): `backend` and `worker` both
   declared `vault-backend` in the shared `apps` namespace — same
   GVK+namespace+name collides into one Kubernetes object, blocking the
   whole `root-app` sync (`RepeatedResourceWarning`). Worker's renamed to
   `vault-backend-worker`.
2. **Stale image tags** (PR #27): `bump-gitops` (PR #25) landed after the
   worker-ci/backend-ci push builds for PR #23/#24 already ran, so
   neither tag was ever bumped — cluster ran worker's old heartbeat loop,
   not the real RabbitMQ consumer. Backfilled both tags to the correct
   shas, digest-confirmed via `docker pull` before commit.
3. **Kafka authorization missing** (PR #28): `KafkaUser` "backend"
   declares `authorization.type: simple` ACLs, but the `Kafka` CR had no
   `spec.kafka.authorization` block — Strimzi's User Operator rejected
   it (wave-3 hook failure blocking wave 4/backend). Added
   `authorization: {type: simple}` (KRaft's `StandardAuthorizer`); no
   `superUsers` needed (Strimzi auto-bootstraps its own components,
   confirmed via strimzi-kafka-operator#12913).
4. **`root-app` self-reference + self-deletion incident** (PR #29,
   ADR-014): `root-app.yaml` was tracking itself via
   `directory.recurse`, non-standard per Argo CD's own app-of-apps docs
   — fixed with `directory.exclude`. **This fix, combined with the
   pre-existing `syncPolicy.automated.prune: true` and root-app already
   self-tracking, caused the very next auto-sync to prune root-app's own
   `Application` object** (Argo CD deleted its own top-level app). No
   cascade deletion (no `resources-finalizer`, all workload pods stayed
   `Running` throughout, confirmed live). Human recovered via
   `kubectl apply -f gitops/root-app.yaml` (~15s to `Synced`/`Healthy`,
   no longer self-tracking). This was foreseeable from the diff alone
   and should have been caught pre-merge — see follow-ups.
5. **No Kafka read access for verification** (PR #30, ADR-015): PR #28's
   authorization fix correctly closed off the previously-open (accidental)
   read access the exit-gate verification procedure relied on — `backend`
   is intentionally producer-only. Added read-only `KafkaUser`
   "gate-verifier" (`Describe`+`Read` on `order-events`, `Read` on one
   fixed consumer group), Strimzi-generated password (debug-only, no
   consuming workload, not Vault-wired).
6. **Vault dev-mode state loss** (diagnosed by gitops-engineer, fixed by
   human running `scripts/bootstrap-vault.sh`): `vault-0` restarted
   (node restart), wiping the Kubernetes auth method again (same failure
   mode as Phase 5) — 8 `ExternalSecret`/`SecretStore` resources
   genuinely `Degraded` (403 on Vault login). Not a sync/cache artifact
   (ruled out via `argocd app sync root-app --core`, no change).

## Reviewer follow-ups (all closed pre-Phase-7, PRs #31/#32)

1. ADR-012 Consequences updated (PR #31) to reference PR #28's
   authorization fix and that its own producer-only ACL design is what
   forced ADR-015's `gate-verifier`.
2. ADR-014 Consequences corrected (PR #32) to accurately document the
   self-deletion incident (was "Harder: none identified", factually
   wrong).
3. `docs/conventions.md` safeguard added (PR #32): changes to
   `root-app.yaml`'s `syncPolicy`/`spec.source.directory` require
   `argocd app diff --local` (or `kubectl diff`) before merge.
4. Terraform drift check (PR #32): `terraform/delivery` state was stale
   (missing the `exclude` field applied by hand) — `plan` showed a safe
   1-attribute in-place update, no destroy/recreate. Human should run
   `terraform apply` to reconcile state at convenience; no live drift.

## Exit gate verification (human + orchestrator, live on Kind)

```
curl -s -X POST http://localhost:8080/orders \
  -H 'Content-Type: application/json' -d '{"productId": 1, "quantity": 1}'
# -> {"id":29,"productId":1,"quantity":1,"totalCents":1299}
```

- RabbitMQ: worker logs — `order 29: sending email + invoice (stub) —
  total 1299 cents`.
- Kafka: `kafka-console-consumer.sh` authenticated as `gate-verifier`
  (SASL/SCRAM-SHA-512) printed
  `{"type":"order.created","order":{"id":29,"productId":1,"quantity":1,
  "totalCents":1299}}` from `order-events`.
- `root-app` `Synced`/`Healthy`, no self-reference. All `SecretStore`/
  `ExternalSecret` `SecretSynced: True`. `KafkaUser` `backend` and
  `gate-verifier` both `Ready: True`. All pods cluster-wide `Running`.

## Key decisions

- ADR-011: RabbitMQ as a plain Deployment (task queue).
- ADR-012: Kafka via Strimzi (KRaft), Vault-sourced `KafkaUser` password.
- ADR-013: automated gitops image-tag bump via CI-opened PR.
- ADR-014: exclude `root-app.yaml` from its own recursive directory scan
  (and the self-deletion incident this surfaced).
- ADR-015: dedicated read-only `gate-verifier` KafkaUser for CLI
  verification, deliberately not Vault-wired.
