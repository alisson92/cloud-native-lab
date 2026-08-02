# ADR-009: Plain manifests, not a Helm chart, for the four application services

- Status: accepted
- Date: 2026-08-02
- Author: app-developer

## Context

Phase 5 (`docs/phases.md`) adds Kubernetes workload manifests for the four
services under `apps/` (backend, BFF, frontend, worker), following the CI and
application code already merged from `phase-5/app-services` (PR #14). This
decision was flagged as pending in `TASKS.md` ("Helm chart vs plain manifests
per application service") and is exactly the kind of trade-off
`docs/architecture.md` calls out explicitly: "A plain Deployment beats a Helm
chart when a chart adds nothing."

The four services look superficially identical (one container, one
Deployment, resource limits, probes) — the kind of repetition a Helm chart is
built to collapse. But looking at what each one actually needs shows they are
not parameter-identical:

| Need                                   | backend | bff | frontend | worker |
|-----------------------------------------|:-------:|:---:|:--------:|:------:|
| Vault `SecretStore`/`ExternalSecret`/`ServiceAccount` | yes | no  | no       | no     |
| `Service` (ClusterIP)                   | yes     | yes | yes      | no     |
| Container port / HTTP probes            | yes     | yes | yes      | no (exec probe) |
| Externally reached (port-forward)       | no      | no  | yes      | no     |

A single chart covering this shape would need `{{- if .Values.needsSecretStore
}}`-style conditionals around roughly a third of its templates (the Vault
wiring, the Service, the container port/probe block, values enabling/disabling
each), plus a `values.yaml` per service to drive them. That is templating
whose job is to reproduce structural differences the plain-YAML alternative
expresses directly and readably — it does not remove duplication, it hides it
behind indirection.

`docs/conventions.md` is explicit on this exact trade-off: "Prefer plain
manifests over a Helm chart when templating adds nothing." Here, templating
would need to model four distinct resource topologies through conditionals,
which is templating whose main effect is obscuring which resources actually
exist for a given service — the opposite of `docs/conventions.md`'s "every
module/service must be understandable by a junior engineer in one reading."
Reading `gitops/services/worker/deployment.yaml` directly and seeing there is
no `service.yaml` in that directory is more legible than reading a chart's
`values.yaml` to discover a `service.enabled: false` flag.

This repository has also already tolerated this exact duplication level three
times over without reaching for a chart: `gitops/secrets-demo/`,
`gitops/data/postgres/`, and `gitops/data/redis/` each hand-write their own
`namespace.yaml` / `serviceaccount.yaml` / `secretstore.yaml` /
`externalsecret.yaml` shape, with only the values (namespace name, Vault role,
KV path) differing between them. Phase 5's four services extend the same
established pattern rather than introducing a new one.

**Apparent tension, addressed:** the CI pipeline for these same four services
(batch 1, PR #14) *does* use a single reusable workflow
(`.github/workflows/service-ci.yml`, invoked via `workflow_call` from
`backend-ci.yml`/`bff-ci.yml`/`frontend-ci.yml`/`worker-ci.yml`). This is not
a contradiction of the decision here — it is the same principle applied to a
different underlying shape. The four services' CI steps (`build -> test ->
scan -> push`) are genuinely parameter-identical: same job structure, same
tool invocations, only `service` and `path` strings differ, with zero
conditional branching required. `workflow_call` is also GitHub Actions' own
first-class reuse mechanism for exactly this case (see
`.github/workflows/service-ci.yml`'s own header comment for the pinned
action versions verified against their release pages), not an extra
abstraction layer bolted on top the way a Helm chart would be here. The two
situations differ in precisely the dimension that matters: uniform steps
with no branching (CI) vs. structurally different Kubernetes resources
depending on the service (deployment manifests).

## Decision

Application workload manifests for backend, BFF, frontend, and worker are
plain Kubernetes YAML, one directory per service under `gitops/services/
<name>/`, mirroring the existing `gitops/data/<name>/` layout. No Helm chart
is introduced for these services.

## Consequences

**Easier:** each service's directory shows exactly the resources that exist
for it — no `values.yaml` to cross-reference to know whether a Service or
Vault wiring is present for a given service. Consistent with the pattern
already established in `gitops/data/postgres/`, `gitops/data/redis/`, and
`gitops/secrets-demo/`, so no new mental model for reviewers or future
agents. No chart repo, chart versioning, or `helm template` step to add to
the Argo CD `root-app.yaml` reconciliation path.

**Harder:** four Deployments duplicate common boilerplate (securityContext
shape, resources block structure, probe field names) with no shared
template to change in one place. A field-name typo could ship independently
in more than one file.

**Accepted trade-off, revisit trigger:** if a future phase adds several more
services with this same shape, or if the per-service variance narrows (e.g.
all four services converge on needing the same Vault/Service/probe surface),
the conditional-branching cost of a chart becomes proportionally smaller
relative to the boilerplate it would remove. That is the point to revisit
this decision — not before, per `docs/conventions.md`'s "no speculative
abstraction."
