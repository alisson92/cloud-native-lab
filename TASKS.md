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

## Phase 3 — Secrets (owner: security-engineer) — CODE DONE

- Summary: Vault (dev-mode) + ESO via GitOps (`gitops/apps/vault.yaml`,
  `gitops/apps/external-secrets.yaml`, official Helm charts). Vault<->ESO
  wiring (`SecretStore`, Kubernetes-auth, `ExternalSecret`, test pod) as
  plain manifests in `gitops/secrets-demo/`. ADR-006 records the dev-mode
  trade-off and the Kubernetes-auth-over-static-token choice. `helm
  template` clean for both charts; yamllint clean; no secret values in any
  file (grepped diff).
- [todo] (HUMAN) Merge PR, then follow `gitops/secrets-demo/README.md`'s
  one-time Vault bootstrap and exit-gate verification (blocked for agents:
  merge is a human gate, and `kubectl apply`/`exec`-driven Vault config
  writes are outside this agent's permitted read-only kubectl scope).

## Phases 4–7

- [todo] To be broken down by the orchestrator when Phase 3 gate passes.
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
