# Application services

Phase 5 (`docs/phases.md`): plain Kubernetes manifests for the four
application services (backend, BFF, frontend, worker), one directory per
service, mirroring the `gitops/data/<name>/` layout established in Phase 4.
See `docs/adr/009-plain-manifests-for-app-services.md` for why these are
plain manifests rather than a Helm chart.

## One shared `apps` Namespace, not one per service

`postgres` and `redis` (Phase 4) each got their own Namespace because they
are separate trust/data domains: different credentials, different failure
modes, no reason for one to reach the other directly. The four Phase 5
services are the opposite — one cohesive application tier that calls itself
constantly in a fixed chain (`frontend -> bff -> backend -> Postgres/Redis`,
per `docs/architecture.md`'s integration map). Splitting them into four
Namespaces would add Kubernetes DNS/NetworkPolicy boundaries between
components that are meant to talk to each other on every single request,
with no corresponding isolation benefit — the kind of extra structure
`docs/conventions.md`'s simplicity section warns against ("no speculative
abstraction"). All four therefore share the `apps` Namespace, created once in
`gitops/services/backend/namespace.yaml` (the only `namespace.yaml` among
these four directories — `bff`, `frontend`, and `worker` rely on it already
existing via Argo CD's sync-wave ordering).

## Vault/SecretStore/ExternalSecret wiring: backend and worker only

Of the four services, backend and worker hold credentials that must come
from Vault. Backend reads Postgres, Redis, and (Phase 6) RabbitMQ
credentials. Worker (Phase 6, replacing the Phase 5 placeholder heartbeat
loop) reads only RabbitMQ credentials, via its OWN ServiceAccount/
SecretStore/role scoped to just `secret/data/rabbitmq` — see
`worker/serviceaccount.yaml`'s comment for why it cannot reuse backend's
`vault-auth` ServiceAccount name and still keep that scoping meaningful.
BFF is a pure HTTP proxy to backend; frontend is a pure HTTP proxy to BFF
plus a static file server — neither has any secret to fetch, so neither
gets a SecretStore/ExternalSecret/ServiceAccount — adding empty Vault
wiring "for consistency" would be dead configuration, which
`docs/conventions.md` explicitly calls a defect ("Delete code and config
that is not used").

## Per-service specifics

Each service's own manifests carry inline comments with the specific
reasoning (image tag placeholder, Service DNS names, security context,
resource sizing). Start there:

- `backend/` — Deployment, Service, Namespace, and full Vault wiring
  (Postgres, Redis, and Phase 6 RabbitMQ credentials).
- `bff/` — Deployment, Service. No Vault wiring, no Namespace (reuses
  `apps` from `backend/namespace.yaml`).
- `frontend/` — Deployment, Service (reached via `kubectl port-forward` for
  the Phase 5 exit gate, no Ingress/NodePort). No Vault wiring, no
  Namespace.
- `worker/` — Deployment, own ServiceAccount/SecretStore/ExternalSecret
  scoped to RabbitMQ credentials only, no Service (no HTTP surface to
  expose), no Namespace. See `worker/README.md`.

## Image tags are bumped automatically by CI, then merged by a human

Each `deployment.yaml`'s `image:` tag pins the exact `github.sha` of the
`main` commit whose CI push job built and pushed that image (tags are
immutable per commit, see `.github/workflows/service-ci.yml`). If you see a
PR titled `chore(gitops): bump <service> image to <sha>` appear on its own
after a merge to `main` touches `apps/<service>/`, that is not a mistake or
an unauthorized commit — it is the `bump-gitops` job in `service-ci.yml`,
which opens (or updates, in place, on the same `ci/bump-<service>-image`
branch) exactly this PR once the new image finishes pushing to GHCR. See
`docs/adr/013-automated-gitops-image-bump-pr.md` for the full reasoning.
The job never merges the PR itself — CLAUDE.md's human merge gate for the
Argo CD-watched branch still applies, same as any other PR.

## Verifying the Phase 5 exit gate

Per `docs/phases.md`: "Order placed end-to-end (sync path, no messaging
yet)". After all four Deployments report `Running`/`Ready`:

```sh
kubectl -n apps get pod
# backend, bff, frontend, worker all 1/1 Ready.

kubectl -n apps port-forward svc/frontend 8082:8082
# In a browser: http://localhost:8082/ — browse the catalog, place an order,
# and confirm it round-trips frontend -> bff -> backend -> Postgres (order
# persisted) and Redis (catalog cache hit on repeat reads).
```
