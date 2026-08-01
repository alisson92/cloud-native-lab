# Foundation: VPC + GKE. Applied after terraform/bootstrap/ has created
# the budget alert and the state bucket this config's state lives in.
#
# Docs consulted:
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_service
# - https://developer.hashicorp.com/terraform/tutorials/kubernetes/gke
# - https://docs.cloud.google.com/service-usage/docs/enabled-service

# Compute Engine API. A fresh GCP project has this disabled, which would fail
# `google_compute_network`/`google_compute_subnetwork` in the VPC module and
# the GKE cluster/node pool, both of which are Compute Engine-backed
# resources under the hood. Declared explicitly and separately from
# `container.googleapis.com` below: HashiCorp's own GKE tutorial
# (developer.hashicorp.com/terraform/tutorials/kubernetes/gke) instructs
# enabling both APIs before applying, and no official source confirms that
# `google_project_service` enabling the Kubernetes Engine API transitively
# enables the Compute Engine API as a side effect (Cloud Console's
# ConsumerPolicy-based hierarchical enablement is a different mechanism from
# the Service Usage API call this resource makes). Being explicit here is
# free and removes the doubt either way.
resource "google_project_service" "compute" {
  project = var.project_id
  service = "compute.googleapis.com"

  disable_on_destroy = false
}

# Kubernetes Engine API. A fresh GCP project has this disabled too, which
# would fail the GKE cluster/node pool resources.
resource "google_project_service" "container" {
  project = var.project_id
  service = "container.googleapis.com"

  disable_on_destroy = false
}

module "vpc" {
  source = "../modules/vpc"

  project_id = var.project_id
  region     = var.region

  depends_on = [
    google_project_service.compute,
    google_project_service.container,
  ]
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

  depends_on = [
    google_project_service.compute,
    google_project_service.container,
  ]
}
