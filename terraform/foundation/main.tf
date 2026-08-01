# Foundation: VPC + GKE. Applied after terraform/bootstrap/ has created
# the budget alert and the state bucket this config's state lives in.
#
# Docs consulted:
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_service

# Kubernetes Engine API. A fresh GCP project has this disabled, which would
# fail both the GKE cluster and (since the Kubernetes Engine API depends on
# the Compute Engine API) the VPC network/subnetwork resources below.
# Enabling container.googleapis.com transitively enables compute.googleapis.com
# as its dependency, so a single resource here covers both modules.
resource "google_project_service" "container" {
  project = var.project_id
  service = "container.googleapis.com"

  disable_on_destroy = false
}

module "vpc" {
  source = "../modules/vpc"

  project_id = var.project_id
  region     = var.region

  depends_on = [google_project_service.container]
}

module "gke" {
  source = "../modules/gke"

  project_id = var.project_id
  zone       = var.zone

  cluster_name = var.cluster_name

  network             = module.vpc.network_id
  subnetwork          = module.vpc.subnetwork_id
  pods_range_name     = module.vpc.pods_range_name
  services_range_name = module.vpc.services_range_name

  node_machine_type = var.node_machine_type
  min_node_count    = var.min_node_count
  max_node_count    = var.max_node_count

  depends_on = [google_project_service.container]
}
