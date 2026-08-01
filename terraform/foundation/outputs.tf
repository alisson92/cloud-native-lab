output "network_name" {
  description = "Name of the VPC network."
  value       = module.vpc.network_name
}

output "subnetwork_name" {
  description = "Name of the subnetwork."
  value       = module.vpc.subnetwork_name
}

output "cluster_name" {
  description = "Name of the GKE cluster."
  value       = module.gke.cluster_name
}

output "cluster_endpoint" {
  description = "IP address of the cluster's Kubernetes API server."
  value       = module.gke.endpoint
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "Base64-encoded public certificate for the cluster's certificate authority."
  value       = module.gke.ca_certificate
  sensitive   = true
}
