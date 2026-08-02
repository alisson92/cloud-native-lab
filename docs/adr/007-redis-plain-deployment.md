# ADR-007: Redis as a plain Deployment, not an operator

- Status: accepted
- Date: 2026-08-02
- Author: data-engineer

## Context

Phase 4 (`docs/phases.md`) requires Redis, used as a catalog cache and
session store (`docs/vision.md`): no durability requirement, no clustering
requirement — the scenario needs one fast key-value store reachable from
the backend. `docs/architecture.md` already leans toward "a simple,
well-supported deployment" for Redis (as opposed to CloudNativePG's
operator for Postgres), but left the choice unresolved as a "Decisions
pending" item in `TASKS.md`.

Alternatives considered:

1. **A Redis Kubernetes operator** (e.g. a community/vendor CRD-based
   operator that manages Redis Sentinel/Cluster topologies, failover, and
   backups). This is the kind of tool that earns its complexity when a
   service needs HA, automated failover, or multi-node clustering — none of
   which this lab needs: `docs/vision.md`'s non-goals explicitly exclude
   "High availability and multi-region setups", and Redis here is a single
   cache instance, not a source of truth. An operator would add a
   dependency, CRDs, and an extra controller to reconcile for a single-pod
   workload with zero HA requirement — the textbook case
   `docs/conventions.md`'s simplicity section warns against ("no
   speculative abstraction").
2. **A plain Deployment + Service**, password wired from Vault via ESO
   (this repo's now-standard pattern from Phase 3). Redis's own official
   Docker guidance (redis.io, "Run Redis Open Source on Docker") documents
   running the server with a single `docker run`/container and treats
   persistence as an explicit, opt-in volume mount — not a prerequisite for
   running Redis at all. This confirms a single-container deployment is the
   tool's own documented baseline for the workload shape this lab needs,
   with no operator implied anywhere in that guidance.

## Decision

Redis runs as a plain Kubernetes `Deployment` (`gitops/data/redis/
deployment.yaml`) with 1 replica and a matching `Service`
(`gitops/data/redis/service.yaml`), password sourced from Vault via ESO. No
PersistentVolumeClaim: Redis's role here is a cache/session store, not a
durable one, and the cluster itself is ephemeral Kind
(`docs/adr/004-local-first-validation-with-kind.md`); losing cached data on
a pod restart is acceptable for this role, and Redis's own Docker docs
already treat the on-disk `/data` directory as ephemeral unless a volume is
explicitly mounted.

## Consequences

**Easier:** no extra CRDs or controller to reconcile for a single-pod
cache; the manifest is readable end-to-end by a junior engineer in one
pass (`docs/conventions.md`); matches the credential-flow pattern already
established for Postgres in this phase (Vault -> ESO -> Secret), so no new
mental model is introduced.

**Harder:** if a future phase needs Redis Sentinel/Cluster (multi-node HA,
automatic failover), this Deployment must be replaced, likely by adopting
an operator at that point — that is an explicit non-goal today
(`docs/vision.md`), so the trade-off is accepted, not deferred debt.

**Accepted gap:** cached data does not survive a pod restart (no PVC). This
is the correct trade-off for a cache/session role in an ephemeral lab, not
a corner cut — Postgres (the actual source of truth for orders) keeps its
own PVC via CloudNativePG (`docs/adr/008-postgres-operator-proportionality.md`).
