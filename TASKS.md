# Task Board

> Coordination blackboard. Every agent reads this before working and updates
> it after finishing. Format: `- [status] (owner) task — notes`
> Statuses: `todo` | `doing` | `review` | `blocked` | `done`

## Phase 1 — Foundation (owner: platform-engineer)

- [review] (platform-engineer) Terraform backend: GCS bucket for state (bootstrapped once, documented) — `terraform/bootstrap/`, see notes below
- [review] (platform-engineer) Budget alert module — FIRST billable-adjacent resource, before everything — `terraform/modules/budget-alert/`
- [review] (platform-engineer) VPC module (minimal: one subnet, secondary ranges for GKE) — `terraform/modules/vpc/`
- [review] (platform-engineer) GKE module: zonal cluster, Spot node pool, sensible defaults — `terraform/modules/gke/`
- [todo] (reviewer) Review Phase 1 modules against official Terraform/GKE docs
- [todo] (HUMAN) Run `terraform apply` after review approval (bootstrap first, then foundation — see `terraform/README.md`)

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
- (orchestrator) Repository bootstrapped: `.gitignore` scoped to the full
  declared stack (Terraform, Python, Node, Kubernetes/Helm, secrets,
  OS/editor artifacts), git initialized, initial docs/config committed one
  file per commit. GitHub repo created public (required for branch
  protection on the Free plan — see `docs/adr/002-public-repo-for-branch-protection.md`),
  `main` protected (PR required, no force-push/deletion, admins enforced).
  Bootstrap steps captured as standing convention in `docs/conventions.md`
  under "Repository bootstrap".
- (platform-engineer) Phase 1 code complete: `terraform/modules/{budget-alert,vpc,gke}`
  (minimal modules, each argument grounded in official
  registry.terraform.io/providers/hashicorp/google docs, see comments),
  `terraform/bootstrap/` (budget alert -> GCS state bucket, local state
  migrated to GCS per the documented HashiCorp/Google pattern),
  `terraform/foundation/` (VPC + GKE, backed by the bucket bootstrap
  creates). Bootstrap ordering problem (budget alert must be first
  billable resource, but state-in-GCS needs a bucket first) resolved and
  recorded in `docs/adr/003-terraform-bootstrap-sequence.md`.
  `terraform fmt` and `terraform validate` are clean on both root modules
  (`terraform/bootstrap`, `terraform/foundation`). `terraform plan` could
  not be produced against real GCP: this sandbox has no `gcloud` and no
  credentials configured (no `~/.config/gcloud`, no
  `GOOGLE_APPLICATION_CREDENTIALS`). Confirmed the failure is purely
  environmental, not a config bug: `bootstrap` plan fails at the provider
  stage with "could not find default credentials"; `foundation` fails one
  step earlier, at `terraform init` against the GCS backend, with the same
  root cause ("storage.NewClient() failed: dialing: credentials: could not
  find default credentials"). No project ID or credentials were faked to
  force a plan through — `project_id` and `billing_account_id` remain
  required variables with no default. Marking all four Phase 1 code tasks
  `review`: code + fmt + validate are genuinely clean, but a real `plan`
  still needs a human to run `gcloud auth application-default login` and
  supply a real `project_id`/`billing_account_id` before it can be
  produced and attached for the reviewer/human gate.
  Branch: `phase-1/terraform-foundation`.
