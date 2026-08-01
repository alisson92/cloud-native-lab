output "id" {
  description = "Fully qualified budget resource ID (billingAccounts/{id}/budgets/{budget_id})."
  value       = google_billing_budget.this.id
}

output "name" {
  description = "Budget resource name, as returned by the Billing Budgets API."
  value       = google_billing_budget.this.name
}
