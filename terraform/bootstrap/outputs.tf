output "state_bucket_name" {
  description = "Name of the GCS bucket holding Terraform state. Use this value in every root module's backend.gcs.tfbackend file."
  value       = google_storage_bucket.terraform_state.name
}

output "budget_id" {
  description = "ID of the budget alert created before the state bucket."
  value       = module.budget_alert.id
}
