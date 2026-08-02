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

## Phase 2 — Delivery (owner: gitops-engineer) — DONE

- Summary: Argo CD bootstrap (Terraform helm_release) + app-of-apps root
  merged via PR #4. Reviewer APPROVED (1 pass, 0 fix rounds). Human
  verified the exit gate on Kind: `root-app` `Synced`/`Healthy`. Full log:
  `docs/phase-logs/phase-2.md`. Key decision: ADR-005.

## Phase 3 — Secrets (owner: security-engineer) — DONE

- Summary: Vault (dev-mode) + ESO via GitOps, Vault->ESO->pod flow in
  `gitops/secrets-demo/`. Reviewer APPROVED PR #6 (1 pass, 1 fix round).
  Two live-only bugs found and fixed post-merge (PRs #7, #8; see
  `docs/phase-logs/phase-3.md`). Human verified the exit gate on Kind:
  `secret-consumer` pod env reflects the Vault-stored value. Key
  decision: ADR-006.

## Phase 4 — Data (owner: data-engineer)

- [todo] To be planned by the orchestrator. Definition in `docs/phases.md`:
  CloudNativePG cluster + Redis via GitOps; credentials from Vault.

## Phases 5–7

- [todo] To be broken down by the orchestrator when Phase 4 gate passes.
  Definitions live in `docs/phases.md`.

## Decisions pending (need ADR)

- [todo] Helm chart vs plain manifests per application service
- [todo] Redis deployment approach (operator vs simple deployment) — justify
  with simplicity principle

## Log

- (orchestrator) Phase 1 log archived to `docs/phase-logs/phase-1.md`;
  board slimmed per the token-discipline rules added to `CLAUDE.md`.
- (orchestrator) Phase 2 log archived to `docs/phase-logs/phase-2.md`;
  exit gate confirmed by human on Kind (`root-app` `Synced`/`Healthy`).
- (orchestrator) Phase 3 log archived to `docs/phase-logs/phase-3.md`;
  exit gate confirmed by human on Kind (secret flowed Vault->ESO->pod).
- (security-engineer) Added gitleaks pre-commit hook (v8.30.1), doc note in
  `docs/conventions.md`. Verified clean on repo, blocks synthetic secret.
  PR opened from `phase-4/gitleaks-precommit`, not phase-gating.
