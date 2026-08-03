# ADR-015: Strimzi-generated (not Vault-sourced) secret for the Kafka gate-verifier user

- Status: accepted
- Date: 2026-08-03
- Author: data-engineer

## Context

ADR-012 (`authorization: simple`) surfaced that `backend`'s `KafkaUser` is
producer-only (`Describe`+`Write` on `order-events`) by design, so no Kafka
identity in this repo can read `order-events` — needed to manually verify
the Phase 6 exit gate ("Order event consumed from both systems",
`docs/phases.md`) before Phase 7's real consumer (Airflow) exists.

A new, minimal, read-only `KafkaUser` is required. ADR-012's precedent
(`backend`) sources its password from Vault via ESO, matching every other
credentialed service in this lab. Strimzi's own docs
(https://strimzi.io/docs/operators/latest/configuring.html, "Managing
users") confirm the alternative: when `spec.authentication.password` is
omitted, the User Operator generates a random password itself and owns a
Secret named after the `KafkaUser` CR.

Weighing the two for this specific user:
- No workload in `gitops/` ever consumes this identity's credential — it
  is used only for ad-hoc `kubectl run kafka-console-consumer.sh`
  verification, by a human or agent with direct cluster access.
- Vault-sourcing would add a fifth `scripts/bootstrap-vault.sh` block
  (KV path, policy, Kubernetes-auth role) for a credential no pod ever
  reads via that role — the Kubernetes-auth binding exists specifically to
  let a *pod's ServiceAccount* authenticate to Vault (ADR-006); there is no
  such pod here.
- It would also add one more thing a human must remember to re-run
  `scripts/bootstrap-vault.sh` for after every Vault dev-mode restart
  (ADR-010), for zero operational benefit.

## Decision

`gitops/data/kafka/gate-verifier-user.yaml`'s `KafkaUser` "gate-verifier"
omits `spec.authentication.password` entirely, letting Strimzi's User
Operator generate and own its own Secret (`gate-verifier`, keys
`password`/`sasl.jaas.config`). No Vault KV entry, no `ExternalSecret`, no
`SecretStore` change. `scripts/bootstrap-vault.sh` is untouched.

## Consequences

**Easier:** verification is fully self-contained in `gitops/` — reading
the generated Secret (`kubectl -n kafka get secret gate-verifier -o
jsonpath='{.data.password}' | base64 -d`) is enough to authenticate, no
Vault dependency, no bootstrap re-run.

**Harder:** this is now the one credentialed identity in this lab that
does *not* follow the Vault -> ESO -> Secret pattern (ADR-012's
Consequences section names that uniformity as a benefit of the opposite
choice for `backend`). Acceptable here because "credentialed identity" is
doing a lot of work — `gate-verifier` never backs a running workload, only
a human's terminal.

**Accepted trade-off:** when Phase 7 adds the real Airflow Kafka consumer,
that `KafkaUser` should follow `backend`'s Vault-sourced pattern (it *is* a
long-lived workload credential), not this ADR's. `gate-verifier` remains a
debug-only identity and should be deleted once Phase 7's real consumer
makes it redundant for gate verification.
