output "cluster_name" {
  description = "Name of the GKE cluster."
  value       = google_container_cluster.this.name
}

output "location" {
  description = "Zone the cluster runs in."
  value       = google_container_cluster.this.location
}

output "endpoint" {
  description = "IP address of the cluster's Kubernetes API server."
  value       = google_container_cluster.this.endpoint
  sensitive   = true
}

output "ca_certificate" {
  description = "Base64-encoded public certificate for the cluster's certificate authority."
  value       = google_container_cluster.this.master_auth[0].cluster_ca_certificate
  sensitive   = true
}

output "node_service_account_email" {
  description = "Email of the dedicated GKE node service account."
  value       = google_service_account.gke_nodes.email
}
