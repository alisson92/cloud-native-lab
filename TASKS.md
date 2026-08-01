# Task Board

> Coordination blackboard. Every agent reads this before working and updates
> it after finishing. Format: `- [status] (owner) task — notes`
> Statuses: `todo` | `doing` | `review` | `blocked` | `done`

## Phase 1 — Foundation (owner: platform-engineer)

- [todo] (platform-engineer) Terraform backend: GCS bucket for state (bootstrapped once, documented)
- [todo] (platform-engineer) Budget alert module — FIRST billable-adjacent resource, before everything
- [todo] (platform-engineer) VPC module (minimal: one subnet, secondary ranges for GKE)
- [todo] (platform-engineer) GKE module: zonal cluster, Spot node pool, sensible defaults
- [todo] (reviewer) Review Phase 1 modules against official Terraform/GKE docs
- [todo] (HUMAN) Run `terraform apply` after review approval

## Phase 2 — Delivery (owner: gitops-engineer)

- [todo] (gitops-engineer) Argo CD bootstrap (Terraform helm_release, pinned version from official docs)
- [todo] (gitops-engineer) App-of-apps root Application pointing at `gitops/`

## Phases 3–7

- [todo] To be broken down by the orchestrator when Phase 2 gate passes.
  Definitions live in `docs/phases.md`.

## Decisions pending (need ADR)

- [todo] Helm chart vs plain manifests per application service
- [todo] Redis deployment approach (operator vs simple deployment) — justify with simplicity principle

## Log

- (orchestrator) Board initialized.
