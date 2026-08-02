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

## Only backend has Vault/SecretStore/ExternalSecret wiring

Of the four services, only backend holds credentials that must come from
Vault (Postgres and Redis passwords). BFF is a pure HTTP proxy to backend;
frontend is a pure HTTP proxy to BFF plus a static file server; worker (this
phase) is a placeholder heartbeat loop with no external connections at all.
None of the three have any secret to fetch, so none of them get a
SecretStore/ExternalSecret/ServiceAccount — adding empty Vault wiring "for
consistency" would be dead configuration, which `docs/conventions.md`
explicitly calls a defect ("Delete code and config that is not used").

## Per-service specifics

Each service's own manifests carry inline comments with the specific
reasoning (image tag placeholder, Service DNS names, security context,
resource sizing). Start there:

- `backend/` — Deployment, Service, Namespace, and full Vault wiring.
- `bff/` — Deployment, Service. No Vault wiring, no Namespace (reuses
  `apps` from `backend/namespace.yaml`).
- `frontend/` — Deployment, Service (reached via `kubectl port-forward` for
  the Phase 5 exit gate, no Ingress/NodePort). No Vault wiring, no
  Namespace.
- `worker/` — Deployment only, no Service (no HTTP surface to expose), no
  Vault wiring, no Namespace. See `worker/README.md`: this is a Phase 6
  placeholder.

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
