# ADR-008: CloudNativePG operator for a single-instance lab Postgres

- Status: accepted
- Date: 2026-08-02
- Author: data-engineer

## Context

Phase 4 (`docs/phases.md`) requires PostgreSQL as the transactional store
for orders (`docs/vision.md`), a single instance, no HA
(`docs/vision.md`'s non-goals exclude "High availability and multi-region
setups"). `docs/architecture.md` names CloudNativePG as the chosen
approach, but this was a "Decisions pending" item in `TASKS.md` because an
operator is real added weight (a controller, CRDs, an extra moving part to
reason about) that `docs/conventions.md`'s simplicity principle requires
justifying, not assuming — a single-instance database is exactly the case
where "do I even need an operator" deserves a real answer, not a rubber
stamp of the architecture doc.

### Alternative 1: a hand-rolled StatefulSet

A plain `StatefulSet` + `Service` + a PVC-backed volumeClaimTemplate is the
simplest-looking option on paper. But CloudNativePG's own docs
(cloudnative-pg.io/documentation/current/bootstrap/) document what that
StatefulSet would have to reimplement even for one instance and zero HA:

- **initdb / first-boot bootstrapping**: creating the database, the app
  user, and applying the Vault-sourced password idempotently on first
  start — CloudNativePG's `bootstrap.initdb` does this from one CR field
  block; a StatefulSet needs a custom init container/entrypoint script
  reimplementing the same logic (and re-tested by hand, not by an
  upstream-maintained project).
- **Correct PVC lifecycle**: a `StatefulSet`'s `volumeClaimTemplate`
  handles PVC creation, but pod-restart-safe reattachment, and any future
  resize, is something CloudNativePG's `storage` API is built and tested
  for; a hand-rolled version is new code with no test coverage of its own.
- **Upgrade path**: CloudNativePG documents supported PostgreSQL major/minor
  upgrade flows through the same CR; a StatefulSet would need
  hand-written, undocumented-for-this-project upgrade procedures.
- **A real path to the HA this lab doesn't need today but that Postgres,
  as the actual system-of-record, is more likely than Redis to eventually
  need**: if a future phase needs a standby, CloudNativePG supports it by
  raising `spec.instances` — no re-platforming. A StatefulSet has no such
  built-in path; adding replication later means retrofitting streaming
  replication and failover logic from scratch.

The "operator adds a dependency" cost is real (CRDs, one controller pod,
one more upstream project version to track — visible in `gitops/apps/
cloudnativepg-operator.yaml`), but it is paid once, is well-documented
(cloudnative-pg.io), and is actively maintained (CNCF Sandbox project,
current stable release 1.30 confirmed live via the official chart repo in
this session). The StatefulSet alternative's cost is not a one-time
dependency — it is ongoing: every one of the four items above becomes code
this project must write, test, and maintain itself, with no upstream to
lean on when something breaks. That inverts the simplicity trade-off: the
operator is the smaller total surface, not the larger one, once bootstrap
and lifecycle correctness are counted.

### Alternative 2 (rejected outright): Redis's own conclusion does not transfer

Postgres is the system of record for orders (`docs/vision.md`); Redis is a
disposable cache. ADR-007 rejects an operator for Redis specifically
because that workload is a single-container process with no
initdb/bootstrap/upgrade surface to manage. Postgres does not share that
shape — this is precisely the "one reason per tool" rule in
`docs/architecture.md`: the two decisions differ because the workloads
differ, not because of a blanket infra-operator preference.

## Decision

Keep CloudNativePG (`gitops/apps/cloudnativepg-operator.yaml`,
`gitops/data/postgres/cluster.yaml`), `spec.instances: 1`, no HA. The
operator's initdb bootstrap, PVC management, and upgrade path are worth the
one-time CRD/controller cost for a workload that is the platform's actual
system of record, even at single-instance scale.

## Consequences

**Easier:** Postgres bootstrap (database/owner/password from the
Vault-sourced Secret) is one CR field block instead of custom
init-container scripting; a future move to `instances: 2+` for HA is a
one-line change, not a re-platform; CloudNativePG's own docs are the
maintained reference for day-2 operations (backup, upgrade), not this
project's own undocumented scripts.

**Harder:** one more Argo CD Application, one more CRD set, one more
project version to track in this repo's dependency surface
(`gitops/apps/cloudnativepg-operator.yaml`'s pinned chart version);
`cnpg-system`'s controller pod is a workload that must itself be healthy
for Postgres to reconcile, an extra failure domain a StatefulSet would not
have.

**Accepted trade-off:** the operator's ongoing maintenance cost (tracking
chart/CRD version bumps) is paid to avoid the larger, uncounted cost of
hand-rolling and maintaining bootstrap/PVC/upgrade logic this project has
no particular expertise advantage in reimplementing correctly.
