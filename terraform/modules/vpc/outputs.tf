output "network_id" {
  description = "Self link/ID of the VPC network, for use as google_container_cluster.network."
  value       = google_compute_network.this.id
}

output "network_name" {
  description = "Name of the VPC network."
  value       = google_compute_network.this.name
}

output "subnetwork_id" {
  description = "Self link/ID of the subnetwork, for use as google_container_cluster.subnetwork."
  value       = google_compute_subnetwork.this.id
}

output "subnetwork_name" {
  description = "Name of the subnetwork."
  value       = google_compute_subnetwork.this.name
}

output "pods_range_name" {
  description = "Name of the secondary range reserved for GKE Pod IPs."
  value       = var.pods_range_name
}

output "services_range_name" {
  description = "Name of the secondary range reserved for GKE Service ClusterIPs."
  value       = var.services_range_name
}
