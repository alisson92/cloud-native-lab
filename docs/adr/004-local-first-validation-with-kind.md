# ADR-004: Local-first validation with Kind; GCP applies deferred

- Status: accepted
- Date: 2026-08-01
- Author: human-operator

## Context

Phase 1 (GCP foundation) is code-complete and merged, but applying it
creates billable resources. The operator wants to advance the project while
deferring cloud spend.

Analysis of the phase plan shows that Phases 2-6 (Argo CD, Vault/ESO, data
services, applications, messaging) depend on *a* Kubernetes cluster, not on
GKE specifically: everything is declared under `gitops/` and reconciled by
Argo CD, which is cluster-agnostic. A local Kind cluster can serve as the
development and validation target at zero cost. Kind is an official
CNCF/Kubernetes SIGs tool (kind.sigs.k8s.io) and the Argo CD installation
method (pinned Helm chart) is identical on any conformant cluster.

Alternatives considered: (a) apply GKE now and keep it running — rejected
on cost; (b) apply GKE ephemerally per work session — rejected as friction:
every session would pay cluster spin-up time and money to validate work
that does not need GKE; (c) wait for GKE before any Phase 2+ work —
rejected: it blocks the project for no technical reason.

## Decision

Use a local Kind cluster as the development and validation target for
Phases 2-6. The exact same code must serve both targets:

- The Argo CD bootstrap (Terraform `helm_release`) is written
  cluster-agnostic, parameterized by kubeconfig path and context. No
  Kind-only or GKE-only logic in modules or in `gitops/`.
- All `gitops/` content is reconciled by Argo CD on Kind exactly as it
  will be on GKE.
- GCP applies (bootstrap + foundation) are deferred to a consolidated,
  ephemeral validation gate: apply, validate GKE-specific behavior,
  destroy. Until then, Terraform state for cloud roots stays local and
  the human gate in `TASKS.md` remains open.

## Consequences

Easier: zero cloud cost until the gate; fast local feedback; Phase 2+ code
is genuinely exercised (not just statically validated) before ever touching
GCP; the ephemeral GKE gate becomes cheap because everything arrives
pre-debugged.

Harder: GKE-specific concerns — Workload Identity/IAM, GCP load balancer
and ingress, Spot node pool behavior, GCS remote state, and the budget
alert — are validated only at the gate. The parameterization must stay
clean: any Kind-only workaround leaking into shared code is a defect.

Trade-off accepted: later validation of GKE specifics in exchange for an
unblocked, cost-free development path.