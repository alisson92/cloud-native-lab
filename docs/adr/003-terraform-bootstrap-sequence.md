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

## Addendum (2026-08-01): API enablement precedes the budget alert

A fresh GCP project has `billingbudgets.googleapis.com` and
`cloudbilling.googleapis.com` disabled, so `module.budget_alert` (which
uses `data.google_billing_account` and creates a `google_billing_budget`)
would fail on the very first `apply`. `terraform/bootstrap/main.tf` now
creates `google_project_service` resources for both APIs, with
`module.budget_alert` depending on them explicitly.

Enabling an API is a free operation — Google does not bill for
`serviceusage.googleapis.com` calls or for an API simply being enabled,
only for its resources once created — so this does not violate the
"budget alert first" rule in `docs/phases.md`: the budget alert remains
the first *billable* resource, API enablement is just a non-billable
precondition for it. The same reasoning applies to `container.googleapis.com`
and `compute.googleapis.com` in `terraform/foundation/main.tf`.

## Addendum (2026-08-01, round 2): the Cloud Resource Manager API needs a manual first enablement

Verified against Google's own "Enabled services" documentation
(docs.cloud.google.com/service-usage/docs/enabled-service): the list of APIs
enabled by default on a new GCP project does **not** include
`cloudresourcemanager.googleapis.com`. It also does not include the Cloud
Billing Budget, Cloud Billing, Kubernetes Engine, or Compute Engine APIs this
repository depends on — so every one of them genuinely needs an explicit
`google_project_service` resource. That part was already correct.

What round 1 missed: `data.google_project` (used inside `module.budget_alert`
to resolve the numeric project number for `budget_filter.projects`) is
itself backed by the Cloud Resource Manager API. On a fresh project, that API
is disabled, so the very first `apply` fails before the budget alert is even
attempted — undermining the whole point of this ADR (budget alert as the
first thing applied).

The fix is not as simple as "add a `google_project_service` for
`cloudresourcemanager.googleapis.com`", because of a confirmed, long-standing
chicken-and-egg problem in `hashicorp/terraform-provider-google`:

- [Issue #6101](https://github.com/hashicorp/terraform-provider-google/issues/6101)
  ("Enabling the Cloud Resource Manager API requires the Cloud Resource
  Manager API") and
  [Issue #11435](https://github.com/hashicorp/terraform-provider-google/issues/11435)
  ("Cannot enable cloudresourcemanager.googleapis.com via Terraform") both
  document the same root cause. Per HashiCorp maintainer
  [@rileykarson's comment](https://github.com/hashicorp/terraform-provider-google/issues/11435#issuecomment-1095290207):
  "The project service (service management) API draws quota/permissions from
  the project of the service account (SA) in use rather than from the
  project of the resource... you'll want to enable the service at project
  creation (wherever in your pipeline — manually, with gcloud, or a separate
  Terraform config)."
- In this repository's layout, the Terraform service account used to apply
  `terraform/bootstrap/` lives in the *same* project it is bootstrapping.
  On a cold project (CRM never enabled), the Service Usage API call that
  `google_project_service` makes to enable **any** service — including an
  attempt to enable CRM itself — fails with "Cloud Resource Manager API has
  not been used in project ... or it is disabled", because that call itself
  needs CRM already enabled in the caller's own project. This is not a bug
  fixed in a later provider version; it is inherent to how the Service Usage
  API resolves quota, confirmed by the maintainer as expected behavior.
- `gcloud`/Cloud Console-driven enablement (using a human operator's own
  credentials, not Terraform's service account) does not hit this
  constraint — this is exactly why every error message from this API tells
  the user to "enable it by visiting console.developers.google.com" as the
  resolution.

Alternatives considered for this specific API:

1. **Rely purely on a `google_project_service` resource, same pattern as the
   other APIs, and hope it self-enables.** Rejected: per the confirmed
   provider issues above, this does not reliably work on a cold, single-SA
   project — the exact topology this repository uses.
2. **Document a one-time manual prerequisite
   (`gcloud services enable cloudresourcemanager.googleapis.com`) in
   `terraform/bootstrap/README.md`, run once by the human operator before the
   very first `apply`, while still declaring a `google_project_service`
   resource for it in Terraform for state-tracking and self-documentation.**
   (chosen) The manual step breaks the cycle exactly once per GCP project's
   lifetime; the Terraform resource becomes a harmless no-op afterward (and
   keeps `disable_on_destroy = false` so it's never disabled by a
   `destroy`), consistent with how every other API in this repository is
   declared.
3. **Create a separate, tiny bootstrap-bootstrap project just to host the
   Terraform service account, sidestepping the same-project constraint.**
   Rejected: adds a second GCP project and a second budget surface for an
   ephemeral lab, pure over-engineering for a one-time manual command.

### Consequences

- `terraform/bootstrap/main.tf` now declares
  `google_project_service.cloudresourcemanager`, and every other
  `google_project_service` resource in that config (plus `module.budget_alert`)
  explicitly depends on it, so the Terraform dependency graph reflects the
  real-world requirement even though the *first* enablement is manual.
- This is the second documented exception (after ADR-002's public-repo
  decision) to "no resource created outside Terraform": narrowly scoped to
  enabling one specific API, required only once per GCP project, with the
  root cause traced to a confirmed upstream provider/API limitation rather
  than a shortcut taken for convenience.
- Anyone bootstrapping a new GCP project for this repository must read
  `terraform/bootstrap/README.md`'s "Prerequisite" section before running
  `terraform init`/`apply` there, or the first `apply` will fail with a
  Cloud Resource Manager API error.
