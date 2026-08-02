# Task Board

> Coordination blackboard. Every agent reads this before working and updates
> it after finishing. Format: `- [status] (owner) task — notes`
> Statuses: `todo` | `doing` | `review` | `blocked` | `done`
>
> **Keep this board lean.** Log entries are at most 10 lines: outcome,
> branch, and pointers. Details belong in commit messages, PR descriptions,
> and ADRs — those are the durable record. At phase close the orchestrator
> moves the phase's log entries to `docs/phase-logs/phase-<n>.md` and leaves
> a summary of at most 5 lines here.

## Phase 1 — Foundation (owner: platform-engineer) — CODE DONE

- Summary: bootstrap (budget alert + GCS state), vpc, gke modules complete.
  Reviewer APPROVED (3rd pass, 2 fix rounds). Full log:
  `docs/phase-logs/phase-1.md`. Key decisions: ADR-002, ADR-003.
- [todo] (HUMAN) Merge PR #2 into `main`, then apply per the "Apply order"
  in `terraform/README.md` (step 0: one-time
  `gcloud services enable cloudresourcemanager.googleapis.com` — see
  `terraform/bootstrap/README.md`). Attach the real `plan` output before
  each `apply`.

## Phase 2 — Delivery (owner: gitops-engineer) — CODE DONE, REVIEWER APPROVED

- Summary: Argo CD bootstrap (Terraform helm_release, chart 10.2.2/v3.4.6)
  + app-of-apps root (`gitops/root-app.yaml`, recursive directory source),
  branch `phase-2/argocd-bootstrap-kind` (includes ADR-004, unpushed on
  local `main` due to branch protection — will land via this PR). Reviewer
  APPROVED (1 pass, 0 fix rounds). Key decisions: ADR-005 (kubeconfig-only
  providers, two-phase apply, local state exception).
- [todo] (HUMAN) Open PR for `phase-2/argocd-bootstrap-kind` → `main`. Before
  merging, run the exit-gate validation locally (zero cost, not gated):
  `kind create cluster --config local/kind/kind-config.yaml`, then the
  two-phase apply in `terraform/delivery/README.md`, then confirm
  `kubectl get application -n argocd root-app` shows `Synced`/`Healthy`.

## Phases 3–7

- [todo] To be broken down by the orchestrator when Phase 2 gate passes.
  Definitions live in `docs/phases.md`.

## Decisions pending (need ADR)

- [todo] Helm chart vs plain manifests per application service
- [todo] Redis deployment approach (operator vs simple deployment) — justify
  with simplicity principle

## Log

- (orchestrator) Phase 1 log archived to `docs/phase-logs/phase-1.md`;
  board slimmed per the token-discipline rules added to `CLAUDE.md`.
