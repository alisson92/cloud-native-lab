# ADR-003: Terraform bootstrap sequence (budget alert before the state bucket)

- Status: accepted
- Date: 2026-08-01
- Author: platform-engineer

## Context

Two rules from this repository's own documentation are in tension:

1. `docs/phases.md`: "The budget alert in Phase 1 is created before any
   other billable resource. This is non-negotiable."
2. `docs/conventions.md`: "State in GCS with locking. Never local state in
   the repository." — which requires a GCS bucket to exist before any
   config can use the `gcs` backend.

The GCS bucket that holds Terraform state is itself a billable GCP
resource (Cloud Storage charges for stored objects, even if the state file
is a few KB). If the bucket is created before the budget alert, rule 1 is
violated by rule 2's own prerequisite — a genuine chicken-and-egg problem,
not a hypothetical one.

HashiCorp's documented pattern for bootstrapping a GCS backend
(developer.hashicorp.com/terraform/language/backend/gcs) and Google's own
tutorial (docs.cloud.google.com/docs/terraform/resource-management/store-state)
is: create the bucket with a config running on the implicit local backend,
then run `terraform init -migrate-state` to move that same config's state
into the bucket it just created.

Alternatives considered:

1. **Bundle the budget alert and the state bucket in one `bootstrap` root
   module, applied with local state first, with an explicit `depends_on`
   forcing the budget alert to be created before the bucket. Migrate that
   config's own state into the bucket afterward.** (chosen)
2. Two fully separate one-resource configs (one for the budget alert, one
   for the bucket), each with its own lifecycle. Technically enforces
   ordering via two separate human-run `apply`s, but permanently splits
   two resources that are conceptually one "bootstrap" concern across two
   states/directories for no benefit, and still needs the same
   local-state-then-migrate dance for the bucket config.
3. Use a non-GCS remote backend (e.g. Terraform Cloud) to sidestep the
   bootstrap problem entirely. Rejected: `docs/conventions.md` requires
   state in GCS, and it adds a dependency on an external, account-gated
   service the project has no other reason to use.
4. Create the GCS bucket manually via `gcloud`/the Console, then
   `terraform import` it. Rejected outright: `CLAUDE.md`'s hard limit
   states no cloud resource is ever created outside Terraform.

## Decision

`terraform/bootstrap/` is a single root module containing both the budget
alert (via the `budget-alert` module) and the state bucket
(`google_storage_bucket.terraform_state`), with `depends_on = [module.budget_alert]`
on the bucket so Terraform's dependency graph — not declaration order —
guarantees the budget alert is created first, even within one `apply`.

This config starts on Terraform's implicit local backend (no `backend`
block). After the first `apply`, a human uncomments the `backend "gcs" {}`
block and runs `terraform init -backend-config=backend.gcs.tfbackend -migrate-state`,
moving the bootstrap config's own state into the bucket it created (a
standard, documented self-referential pattern). The exact sequence is
written out in `terraform/bootstrap/README.md`.

`terraform/foundation/` (VPC + GKE) is a second, separate root module,
applied only after bootstrap, initialized directly against the
already-existing bucket. Ordering across the two configs is therefore
enforced by them being two sequential, human-run `apply` operations, not
by any Terraform mechanism — which is sufficient, since a human already
gates every `apply` in this project.

Both root modules use partial backend configuration (empty `backend "gcs" {}`
block, values supplied via a gitignored `*.gcs.tfbackend` file at `init`
time) so no project-specific bucket name is ever hardcoded in
version-controlled code, matching the same "no default for environment-specific
values" rule applied to `project_id`.

## Consequences

- The budget alert is genuinely the first billable-adjacent resource ever
  applied in this project, including before the state bucket — the
  non-negotiable rule in `docs/phases.md` is honored literally, not just
  in spirit.
- Bootstrapping is a one-time, mostly-manual sequence (local apply, then
  edit a file, then migrate) that cannot be fully automated without
  pre-existing state storage — the tutorials from both HashiCorp and
  Google accept this as inherent to the problem. It only needs to happen
  once per GCP project's lifetime, not on every environment rebuild (see
  `terraform/bootstrap/README.md`, "Re-running / destroying").
- Local state briefly exists on disk during the first `apply`, before
  migration. It must never be committed — already covered by the
  `*.tfstate` rule in `.gitignore`.
- Anyone re-reading `terraform/bootstrap/versions.tf` must notice the
  commented-out backend block and know to uncomment it after the first
  apply; this is documented inline in the file itself and in the README,
  but it is a manual step a human could get wrong. Accepted as the
  simplest option given the constraints (see alternatives above).
