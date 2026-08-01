# Budget alert, scoped to a single project.
#
# This module has no dependency on any other resource in this repository on
# purpose: docs/phases.md requires the budget alert to be the first billable
# resource ever applied, before the Terraform state bucket itself. See
# terraform/bootstrap/main.tf for how that ordering is enforced, and
# docs/adr/003-terraform-bootstrap-sequence.md for the full rationale.
#
# Docs consulted:
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/billing_budget
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/data-sources/billing_account
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/data-sources/project

data "google_billing_account" "account" {
  billing_account = var.billing_account_id
}

# budget_filter.projects expects "projects/{project_number}", not the
# project_id string, so the numeric project number must be looked up.
data "google_project" "project" {
  project_id = var.project_id
}

resource "google_billing_budget" "this" {
  billing_account = data.google_billing_account.account.id
  display_name    = var.display_name

  budget_filter {
    projects = ["projects/${data.google_project.project.number}"]
  }

  amount {
    specified_amount {
      # The Cloud Billing Budget API rejects a currency_code that doesn't
      # match the billing account's own currency, so it is read from the
      # account instead of being configurable/hardcoded here.
      currency_code = data.google_billing_account.account.currency_code
      units         = tostring(var.amount)
    }
  }

  dynamic "threshold_rules" {
    for_each = var.threshold_percents
    content {
      threshold_percent = threshold_rules.value
    }
  }
}
