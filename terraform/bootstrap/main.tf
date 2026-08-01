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

module "budget_alert" {
  source = "../modules/budget-alert"

  project_id         = var.project_id
  billing_account_id = var.billing_account_id
  amount             = var.budget_amount
  display_name       = "cloud-native-lab monthly budget"
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
