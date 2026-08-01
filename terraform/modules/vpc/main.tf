# Minimal VPC for the lab: one custom-mode network, one subnetwork, two
# secondary ranges (Pods, Services) so the GKE module can run a VPC-native
# cluster. No extra firewall rules: GKE manages the firewall rules it needs
# for control-plane <-> node communication automatically on cluster
# creation. Nothing else (bastion, NAT, multiple subnets) is in scope for
# this lab; add it only when a real requirement shows up.
#
# Docs consulted:
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_network
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_subnetwork

resource "google_compute_network" "this" {
  project = var.project_id
  name    = var.network_name

  # Custom-mode: we declare the single subnetwork explicitly below instead
  # of accepting the auto-created per-region /20 subnets.
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "this" {
  project = var.project_id
  name    = var.subnet_name
  region  = var.region
  network = google_compute_network.this.id

  ip_cidr_range = var.subnet_cidr

  secondary_ip_range {
    range_name    = var.pods_range_name
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = var.services_range_name
    ip_cidr_range = var.services_cidr
  }

  # Lets nodes without external IPs reach Google APIs (Artifact Registry,
  # Cloud Logging/Monitoring) over Google's private network path.
  private_ip_google_access = true
}
