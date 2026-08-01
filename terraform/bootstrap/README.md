# Bootstrap

Creates, in strict order, the two prerequisites every other Terraform
config in this repository depends on:

1. The budget alert (`module.budget_alert`) — must exist before any other
   billable resource, per `docs/phases.md`.
2. The GCS bucket that holds Terraform state (`google_storage_bucket.terraform_state`)
   — created only after the budget alert, enforced by an explicit
   `depends_on` in `main.tf`.

Full rationale for this ordering (and the alternatives considered) is in
`docs/adr/003-terraform-bootstrap-sequence.md`.

## Prerequisite: enable the Cloud Resource Manager API manually (one time)

Before running `terraform init`/`apply` in this directory for the **first
time ever** on a given GCP project, a human with sufficient IAM permissions
(Owner/Editor, or `roles/serviceusage.serviceUsageAdmin`) must run:

```sh
gcloud services enable cloudresourcemanager.googleapis.com --project=<real-project-id>
```

This cannot be done by Terraform itself on a cold project. The Service Usage
API that backs every `google_project_service` resource draws its
quota/permission check from the *calling identity's own project* — on a
fresh project where Terraform's identity lives in that same project, this
means every `google_project_service` call, including one that tries to
enable the Cloud Resource Manager API itself, fails with "Cloud Resource
Manager API has not been used in project ... or it is disabled" until CRM is
already enabled. `gcloud`/Cloud Console enablement (using a human's own
credentials) does not hit this constraint and is the standard, HashiCorp- and
Google-documented way to break the cycle. Full citations and root-cause
detail are in the addendum to `docs/adr/003-terraform-bootstrap-sequence.md`.

This is a one-time step per GCP project, not per `apply`: once CRM is
enabled, it stays enabled (`disable_on_destroy = false` on every
`google_project_service` resource in this repository), and this config's own
`google_project_service.cloudresourcemanager` resource becomes a no-op that
just keeps the requirement declared in code.

## One-time sequence (human-run; never automated, never `apply`d by an agent)

This config intentionally starts on Terraform's implicit **local** backend
— it can't point its own state at a GCS bucket that doesn't exist yet.

1. `cd terraform/bootstrap`
2. `terraform init`
3. `terraform plan -var="project_id=<real-project-id>" -var="billing_account_id=<real-billing-account-id>" -var="state_bucket_name=<globally-unique-bucket-name>"`
   (or put these in a gitignored `terraform.tfvars`)
4. Review the plan. Confirm the budget alert appears **before** the bucket
   in the plan's resource ordering / apply order.
5. `terraform apply` with the same vars. This is a human-run step — no
   agent in this repository is allowed to run `apply`.
6. Copy `backend.gcs.tfbackend.example` to `backend.gcs.tfbackend` and set
   `bucket` to the real bucket name (the `state_bucket_name` output from
   step 5).
7. Uncomment the `backend "gcs" {}` block in `versions.tf`.
8. `terraform init -backend-config=backend.gcs.tfbackend -migrate-state`
   and confirm the migration when prompted. This config's own state (the
   budget alert + the bucket resource) now lives inside the bucket it
   created, under the `bootstrap/` prefix.

After this, `terraform/foundation/` (VPC + GKE) is initialized directly
against the now-existing bucket — see its own `backend.gcs.tfbackend.example`
— no local-state phase needed there.

## Re-running / destroying

This lab is ephemeral by design (`docs/vision.md`), but bootstrap is the
one config that should rarely, if ever, be destroyed: destroying the state
bucket destroys every other config's state too. If the whole environment
is torn down and rebuilt, prefer keeping the same bootstrap bucket and
budget alert, and only apply/destroy `terraform/foundation/` (and later
phases) against it.
