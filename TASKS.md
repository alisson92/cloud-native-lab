# Task Board

> Coordination blackboard. Every agent reads this before working and updates
> it after finishing. Format: `- [status] (owner) task — notes`
> Statuses: `todo` | `doing` | `review` | `blocked` | `done`

## Phase 1 — Foundation (owner: platform-engineer)

- [done] (platform-engineer) Terraform backend: GCS bucket for state (bootstrapped once, documented) — `terraform/bootstrap/`. Reviewer APPROVED (3rd pass).
- [done] (platform-engineer) Budget alert module — FIRST billable-adjacent resource, before everything — `terraform/modules/budget-alert/`. Reviewer APPROVED (3rd pass).
- [done] (platform-engineer) VPC module (minimal: one subnet, secondary ranges for GKE) — `terraform/modules/vpc/`. Reviewer APPROVED (1st pass, one nit).
- [done] (platform-engineer) GKE module: zonal cluster, Spot node pool, sensible defaults — `terraform/modules/gke/`. Reviewer APPROVED (3rd pass).
- [done] (reviewer) Review Phase 1 modules against official Terraform/GKE docs — final verdict **APPROVED** (3rd pass) after 2 fix rounds. Phase 1 reviewer gate in `docs/phases.md` is satisfied.
- [todo] (HUMAN) Phase 1 code is approved and merge-ready (PR #2). Before `terraform apply`, in order: (1) install `gcloud`, run `gcloud auth application-default login`; (2) one-time per GCP project: `gcloud services enable cloudresourcemanager.googleapis.com --project=<id>` (Terraform cannot self-enable this on a cold project — see `terraform/bootstrap/README.md`); (3) follow `terraform/README.md` "Apply order" — bootstrap first with real `project_id`/`billing_account_id`/`state_bucket_name`, migrate state to GCS, then `foundation`; (4) attach the real `plan` output before running `apply`. Merging PR #2 into `main` is also a human action — orchestrator/agents never merge.

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
- (platform-engineer) Fix round on PR #2 review verdict, all six findings
  addressed on `phase-1/terraform-foundation`:
  Blockers: (1) added `google_project_service` resources —
  `billingbudgets.googleapis.com` + `cloudbilling.googleapis.com` in
  `terraform/bootstrap/main.tf` (`module.budget_alert` depends on both,
  `disable_on_destroy = false`), `container.googleapis.com` in
  `terraform/foundation/main.tf` (both `module.vpc` and `module.gke`
  depend on it, on the claim that enabling the Kubernetes Engine API
  transitively enables the Compute Engine API it depends on. **Correction
  (round 2, see below): this was never actually confirmed in official docs —
  it was an unverified assumption, since fixed by adding an explicit
  `compute.googleapis.com` resource instead of relying on it.**); appended a
  short addendum to
  `docs/adr/003-terraform-bootstrap-sequence.md` explaining why free API
  enablement doesn't break the "budget alert first" rule.
  (2) `currency_code` in `terraform/modules/budget-alert/` now reads
  `data.google_billing_account.account.currency_code` (confirmed as a
  documented exported attribute of that data source) instead of a
  hardcoded `"USD"`; the `currency_code` variable was deleted and the
  `budget_amount` doc comments in both the module and
  `terraform/bootstrap/variables.tf` were reworded to stop claiming USD.
  Should-fix: (3) `google_container_node_pool.spot` now has
  `depends_on = [google_project_iam_member.gke_nodes_default_sa]`;
  (4) the pinned `disk_type = "pd-standard"` was dropped in favor of the
  provider/GKE default (no measured cost reason existed to justify the
  deviation) — the `node_disk_type` variable was removed as unused;
  (5) the `node_machine_type` description in
  `terraform/modules/gke/variables.tf` was reworded to state the honest
  scope (sized for Phases 1-3, revisit before Phase 5/6); (6) the broken
  ADR reference in `terraform/modules/budget-alert/main.tf`
  (`003-bootstrap-sequence.md`) was fixed to the real filename
  (`003-terraform-bootstrap-sequence.md`).
  Verification: `terraform fmt -recursive -diff` clean (no changes
  needed) on the whole `terraform/` tree; `terraform init -backend=false`
  + `terraform validate` clean on both `terraform/bootstrap` and
  `terraform/foundation` independently. Re-confirmed `plan` still fails
  purely on the same environmental cause as before the fix round (no
  `gcloud`/ADC credentials in this sandbox) — `bootstrap` fails at the
  provider stage ("could not find default credentials"), `foundation`
  fails one step earlier at GCS backend init
  ("storage.NewClient() failed: ... could not find default credentials")
  — not a new config bug introduced by this round. Four commits, one per
  logical change (API enablement, currency fix, GKE should-fixes, ADR-003
  addendum). Flipping the four Phase 1 code tasks back to `review` for
  the reviewer's second pass.
- (reviewer) Second review of PR #2. Verdict: **CHANGES REQUESTED**, but
  small — one new blocker (a residual gap in round 1's own fix, not a
  regression) and one should-fix.
  Blocker: `terraform/modules/budget-alert/main.tf`'s `data.google_project`
  is backed by the Cloud Resource Manager API, which is never enabled
  anywhere in the repo — round 1 enabled `billingbudgets`/`cloudbilling`/
  `container` but missed `cloudresourcemanager.googleapis.com`, so the very
  first `apply` (the budget alert) was still expected to fail.
  Should-fix: the round-1 comment claiming `container.googleapis.com`
  transitively enables `compute.googleapis.com` was never verified against
  official docs (HashiCorp's own GKE tutorial says to enable both
  explicitly); `google_compute_network`/`google_compute_subnetwork` in the
  VPC module depend on this being true, so it needed an explicit resource,
  not an assumption. Also flagged the TASKS.md log entry overstating this
  as "confirmed via Google's own docs".
  Sent back to platform-engineer for a second fix round.
- (platform-engineer) Round 2 fix on PR #2, both findings addressed on
  `phase-1/terraform-foundation` (worked from the existing branch — a
  sibling agent worktree already had it checked out, so this worktree's
  local branch was fast-forwarded to `origin/phase-1/terraform-foundation`
  rather than creating a new branch):
  Blocker: researched the Cloud Resource Manager API bootstrap problem
  before writing any code. Confirmed via Google's own "Enabled services"
  doc (docs.cloud.google.com/service-usage/docs/enabled-service) that
  `cloudresourcemanager.googleapis.com` is genuinely not on the
  default-enabled list for a new project (neither is `compute.googleapis.com`,
  which independently supports the should-fix below). Then confirmed, via
  `hashicorp/terraform-provider-google` issues #6101 and #11435 (fetched
  directly from GitHub, including maintainer @rileykarson's comment on
  #11435), that self-enabling CRM via `google_project_service` is a
  genuine, unresolved chicken-and-egg on a cold project where Terraform's
  service account lives in the same project being bootstrapped: the
  Service Usage API draws its quota/permission check from the caller's own
  project, so on a fresh project every `google_project_service` call
  (including one enabling CRM itself) fails until CRM is already enabled.
  This is exactly this repository's topology, so self-enabling cannot be
  relied on. Fix: added `google_project_service.cloudresourcemanager` in
  `terraform/bootstrap/main.tf` for declarative tracking/idempotency
  (`disable_on_destroy = false`, wired into `depends_on` for the other two
  `google_project_service` resources and `module.budget_alert`), **and**
  documented a one-time manual prerequisite
  (`gcloud services enable cloudresourcemanager.googleapis.com --project=<id>`,
  run once per GCP project by a human before the very first `apply`) in a
  new "Prerequisite" section of `terraform/bootstrap/README.md`, with the
  root cause explained. Recorded the full research trail, citations, and
  alternatives considered as a new addendum ("round 2") to
  `docs/adr/003-terraform-bootstrap-sequence.md`.
  Should-fix: added an explicit `google_project_service.compute` resource
  in `terraform/foundation/main.tf` (`module.vpc` and `module.gke` both now
  depend on both `compute.googleapis.com` and `container.googleapis.com`),
  removed the unverified transitive-enable claim from the comment above
  `google_project_service.container` and replaced it with the honest
  rationale (HashiCorp's GKE tutorial instructs enabling both explicitly;
  no official source confirms `google_project_service`'s enable mechanism
  transitively activates dependent APIs — Cloud Console's ConsumerPolicy
  hierarchical enablement is a different, unrelated mechanism). Corrected
  the overstated round-1 log entry above in place rather than leaving it to
  mislead future readers.
  Verification: `terraform fmt -recursive -diff` clean (no changes needed)
  on the whole `terraform/` tree; `terraform init -backend=false` +
  `terraform validate` clean on both `terraform/bootstrap` and
  `terraform/foundation` independently. Re-ran `terraform plan` with dummy
  vars on both: `bootstrap` still fails at the provider stage ("could not
  find default credentials"), `foundation` still fails at GCS backend init
  ("Backend initialization required" / credentials, since it was run with
  `-backend=false` then a config-only `init`) — same purely
  environmental/credential failure mode as round 1, confirming this round
  introduced no new config bug. Three code/doc commits (CRM API fix,
  ADR-003 round-2 addendum, `compute.googleapis.com` should-fix), plus this
  task-board update. Flipping the four Phase 1 code tasks back to `review`
  for the reviewer's third pass.
- (reviewer) Third and final review of PR #2. Verdict: **APPROVED**.
  Independently re-ran every mechanical check (`fmt -check`, `init
  -backend=false` + `validate` on both root modules, `plan` attempts) —
  all clean, failure mode still purely credential/environmental, no new
  config bugs. Re-verified round 2's blocker fix from source rather than
  from the report: pulled issues #6101/#11435 directly via `gh api` and
  confirmed the maintainer quote in ADR-003 is accurate; pulled Google's
  "Enabled services" doc and confirmed `cloudresourcemanager`, `compute`,
  `container`, `billingbudgets`, `cloudbilling` are all genuinely absent
  from the default-enabled list (while `storage.googleapis.com` — why the
  state bucket needs no API resource — is present). Confirmed
  `terraform/bootstrap/README.md`'s prerequisite section is clear and the
  ADR-003 addendum honestly describes the step as manual rather than
  claiming full automation. Re-verified the should-fix (`compute`
  explicitly enabled, transitive claim removed and replaced with the
  HashiCorp tutorial citation, verified verbatim) and did a full regression
  sweep on all round-1 fixes — nothing regressed.
  Five non-blocking nits raised, none requiring another round; orchestrator
  applied the two with real operator value directly: (1) a note in
  `terraform/bootstrap/README.md` that a 403 on the first `apply` right
  after enabling an API is eventual-consistency, not a config bug — retry;
  (2) a cross-reference to the CRM prerequisite added as step 0 in
  `terraform/README.md`'s "Apply order" so a reader starting there doesn't
  hit the failure blind. Also fixed an inaccurate premise in ADR-003 (it
  referred to "the Terraform service account" as an established fact; no
  service account exists in this repo — the documented auth path is human
  ADC, corrected in place). The other nits (an incomplete "alternatives
  considered" list in ADR-003, and an already-resolved `disable_on_destroy`/
  `deletion_policy` question) were left as-is — optional polish, not worth
  another agent round.
  **Phase 1's reviewer gate in `docs/phases.md` is satisfied.** Remaining
  work is entirely the `[todo] (HUMAN)` item above.
