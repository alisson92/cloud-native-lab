# Task Board

> Coordination blackboard. Every agent reads this before working and updates
> it after finishing. Format: `- [status] (owner) task — notes`
> Statuses: `todo` | `doing` | `review` | `blocked` | `done`

## Phase 1 — Foundation (owner: platform-engineer)

- [blocked] (platform-engineer) Terraform backend: GCS bucket for state (bootstrapped once, documented) — `terraform/bootstrap/`. Reviewer: CHANGES REQUESTED (missing API enablement)
- [blocked] (platform-engineer) Budget alert module — FIRST billable-adjacent resource, before everything — `terraform/modules/budget-alert/`. Reviewer: CHANGES REQUESTED (hardcoded `currency_code = "USD"`, missing API enablement, broken ADR path reference)
- [done] (platform-engineer) VPC module (minimal: one subnet, secondary ranges for GKE) — `terraform/modules/vpc/`. Reviewer: APPROVED with a nit (misleading comment on `private_ip_google_access`)
- [blocked] (platform-engineer) GKE module: zonal cluster, Spot node pool, sensible defaults — `terraform/modules/gke/`. Reviewer: CHANGES REQUESTED (missing API enablement, missing `depends_on` on node pool for IAM propagation, undocumented `disk_type` deviation, misleading machine-type sizing claim)
- [done] (reviewer) Review Phase 1 modules against official Terraform/GKE docs — verdict CHANGES REQUESTED, see notes below
- [todo] (HUMAN) Run `terraform apply` after review approval (bootstrap first, then foundation — see `terraform/README.md`). Still blocked: findings below must be fixed first, then a human needs `gcloud auth application-default login` + real `project_id`/`billing_account_id` to produce a real plan.

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
- (reviewer) Reviewed PR #2 against `docs/conventions.md` and official
  HashiCorp/Google docs. Verdict: **CHANGES REQUESTED**. Ran `terraform fmt
  -check -recursive`, `init`/`validate` on both root modules independently
  (did not trust the platform-engineer's claims) — confirmed both are
  clean, and confirmed the `plan` failures are purely credential/environment
  related, not config bugs.
  Blockers: (1) no `google_project_service` resources anywhere — a fresh
  GCP project has `billingbudgets.googleapis.com`, `container.googleapis.com`,
  etc. disabled, so the human's first `apply` will fail on exactly the
  budget alert `docs/phases.md` calls non-negotiable; (2) `currency_code`
  hardcoded to `USD` in the budget-alert module — will fail on a non-USD
  billing account, should read `data.google_billing_account.account.currency_code`
  instead.
  Should-fix: missing `depends_on` between the GKE node pool and its IAM
  binding (registration can race IAM propagation); `disk_type =
  "pd-standard"` deviates from the provider/GKE default with no cited
  reason; the `node_machine_type` variable description overstates what 2x
  e2-medium Spot nodes can actually host; broken doc reference
  (`docs/adr/003-bootstrap-sequence.md` instead of the real
  `003-terraform-bootstrap-sequence.md`) in the budget-alert module comment.
  Nits (orchestrator fixed directly, outside platform-engineer's scope):
  dead `!*.tfvars.example`/`!*.tfbackend.example` gitignore rules removed
  (no-ops — `*.tfvars` never matched `*.tfvars.example` to begin with);
  Portuguese `.gitignore` comments translated to English (project rule:
  English only); added missing `.claude/worktrees/` ignore rule (local
  Agent-tool worktree state was showing as untracked).
  Confirmed correct and left as-is: dedicated GKE node service account +
  `roles/container.defaultNodeServiceAccount` (hardening guidance),
  `remove_default_node_pool` pattern, `deletion_protection = false`
  (justified for an ephemeral lab), VPC-native networking, the bootstrap
  local-state-then-migrate sequence and ADR-003 itself.
  Full findings with severities and doc citations kept in the orchestrator's
  session; PR #2 comment thread is the durable record once posted.
  Sent back to platform-engineer for a fix round.
