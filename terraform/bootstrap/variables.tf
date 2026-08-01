variable "project_id" {
  description = "GCP project ID to bootstrap. No default: this must never be hardcoded (it is environment-specific)."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID (bare form) that owns the project. No default: account-specific."
  type        = string
}

variable "region" {
  description = "Region for the Terraform state bucket. Regional (not multi-region) to keep storage cost minimal for a lab."
  type        = string
  default     = "us-central1"
}

variable "state_bucket_name" {
  description = "Globally unique name for the GCS bucket that will hold Terraform state. GCS bucket names are global across all of GCP, so this has no safe default."
  type        = string
}

variable "budget_amount" {
  description = "Monthly budget cap, in the billing account's own currency (see the budget-alert module, which reads it from data.google_billing_account.account.currency_code), passed through to the budget-alert module."
  type        = number
  default     = 20
}
