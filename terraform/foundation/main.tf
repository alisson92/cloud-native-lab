# Foundation: VPC + GKE. Applied after terraform/bootstrap/ has created
# the budget alert and the state bucket this config's state lives in.

module "vpc" {
  source = "../modules/vpc"

  project_id = var.project_id
  region     = var.region
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
}
