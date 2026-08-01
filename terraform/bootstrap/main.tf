# Bootstrap: creates, in this order, the two resources that must exist
# before any other Terraform config in this repository can run:
#   1. The budget alert (docs/phases.md: "created before any other
#      billable resource. This is non-negotiable.")
#   2. The GCS bucket that will hold all Terraform state, including this
#      config's own state after migration (see README.md).
#
# The explicit `depends_on` on the bucket is what makes the ordering
# guarantee real: without it, Terraform would be free to create both
# resources in parallel since neither's arguments reference the other.
#
# Docs consulted:
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket
# - https://developer.hashicorp.com/terraform/language/backend/gcs
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_service

# The Cloud Resource Manager API. Required before ANY `google_project_service`
# resource in this repository can run, not just this one: the Service Usage
# API (which `google_project_service` calls under the hood) draws its
# quota/permission check from the *calling identity's own project*, and on a
# brand-new project that identity's project is this same project. If CRM has
# never been enabled here, that check itself fails with "Cloud Resource
# Manager API has not been used in project ... or it is disabled" -- for
# every service, including CRM itself. This is a confirmed, unresolved
# provider/API limitation (not something this config can route around), see
# the addendum to docs/adr/003-terraform-bootstrap-sequence.md. Because of
# that catch-22, this resource cannot reliably perform the *first* enablement
# of CRM on a cold project -- see `README.md` for the required one-time
# manual prerequisite. Declaring it here is still correct: once CRM is
# enabled (manually, once), this resource is a no-op on every subsequent
# `apply` and keeps the requirement self-documenting in code.
resource "google_project_service" "cloudresourcemanager" {
  project = var.project_id
  service = "cloudresourcemanager.googleapis.com"

  disable_on_destroy = false
}

# APIs required before the budget alert can be created. A fresh GCP project
# has both disabled: `google_billing_budget` needs the Cloud Billing Budget
# API, and the `google_billing_account` data source (used inside the
# budget-alert module) needs the Cloud Billing API. Enabling an API is a
# free, non-billable operation, so this legitimately precedes the budget
# alert without breaking the "budget first" rule in docs/phases.md (see
# the note appended to docs/adr/003-terraform-bootstrap-sequence.md).
resource "google_project_service" "billingbudgets" {
  project = var.project_id
  service = "billingbudgets.googleapis.com"

  # Keep the API enabled after a `terraform destroy`: disabling it is a
  # project-wide side effect with no cost benefit, and re-enabling on every
  # rebuild only adds latency to the next `apply`.
  disable_on_destroy = false

  depends_on = [google_project_service.cloudresourcemanager]
}

resource "google_project_service" "cloudbilling" {
  project = var.project_id
  service = "cloudbilling.googleapis.com"

  disable_on_destroy = false

  depends_on = [google_project_service.cloudresourcemanager]
}

module "budget_alert" {
  source = "../modules/budget-alert"

  project_id         = var.project_id
  billing_account_id = var.billing_account_id
  amount             = var.budget_amount
  display_name       = "cloud-native-lab monthly budget"

  # `data.google_project` (used inside the budget-alert module to resolve the
  # numeric project number) is itself a Cloud Resource Manager API call.
  depends_on = [
    google_project_service.cloudresourcemanager,
    google_project_service.billingbudgets,
    google_project_service.cloudbilling,
  ]
}

resource "google_storage_bucket" "terraform_state" {
  project  = var.project_id
  name     = var.state_bucket_name
  location = var.region

  storage_class = "STANDARD"

  # State history matters more than storage cost here: versioning lets a
  # bad `apply` be recovered from without re-importing every resource.
  versioning {
    enabled = true
  }

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Never let a stray `terraform destroy` here silently delete state for
  # every other config in the repository.
  force_destroy = false

  depends_on = [module.budget_alert]
}
