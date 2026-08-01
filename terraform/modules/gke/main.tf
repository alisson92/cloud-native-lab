# Zonal GKE cluster, VPC-native, with a single Spot node pool. No Autopilot
# (we need direct control over Spot usage and node sizing), no Workload
# Identity (per docs/architecture.md, secrets flow through Vault + External
# Secrets Operator, not GCP APIs, so nothing here needs it yet; add it if a
# later phase introduces a real requirement).
#
# Docs consulted:
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_cluster
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_node_pool
# - https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account
# - https://docs.cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster
#   ("create a custom service account for your nodes ... give it only the
#   permissions that GKE needs to run system tasks")

# Dedicated node service account instead of the default Compute Engine SA,
# per GKE hardening guidance. `roles/container.defaultNodeServiceAccount`
# is the predefined role bundling exactly what node system tasks need
# (logging, monitoring, metrics) - no hand-picked role list to keep in
# sync.
resource "google_service_account" "gke_nodes" {
  project      = var.project_id
  account_id   = "${var.cluster_name}-nodes"
  display_name = "GKE node service account for ${var.cluster_name}"
}

resource "google_project_iam_member" "gke_nodes_default_sa" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

resource "google_container_cluster" "this" {
  project = var.project_id
  name    = var.cluster_name

  # A zone (not a region) here makes this a zonal cluster: single control
  # plane replica, no cross-zone control plane cost. Matches the lab's
  # explicit non-HA scope (docs/vision.md).
  location = var.zone

  network    = var.network
  subnetwork = var.subnetwork

  # VPC-native cluster: Pods/Services get IPs from the subnetwork's
  # secondary ranges instead of routes-based networking.
  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.services_range_name
  }

  # We can't create a cluster with zero node pools, but node pools are
  # managed as separate google_container_node_pool resources (below), so
  # the default pool is created with the minimum size and removed
  # immediately. Documented pattern from the resource's own docs.
  remove_default_node_pool = true
  initial_node_count       = 1

  # This lab is explicitly ephemeral (docs/vision.md: "the whole
  # environment can be destroyed and recreated"), so we don't want the
  # provider's deletion-protection default (true) to block a routine
  # `terraform destroy`.
  deletion_protection = false
}

resource "google_container_node_pool" "spot" {
  project  = var.project_id
  name     = "${var.cluster_name}-spot-pool"
  location = var.zone
  cluster  = google_container_cluster.this.name

  autoscaling {
    min_node_count = var.min_node_count
    max_node_count = var.max_node_count
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type = var.node_machine_type
    disk_size_gb = var.node_disk_size_gb
    # disk_type intentionally omitted: accept the provider/GKE default
    # (pd-balanced, or hyperdisk-balanced where supported) rather than
    # pinning pd-standard without a measured cost reason
    # (docs/conventions.md: "Prefer defaults from official docs over
    # custom tuning without a measured reason").

    # Spot VMs: same machine, no capacity guarantee, no minimum runtime,
    # priced at a steep discount vs. on-demand. Acceptable for a lab where
    # workloads can tolerate node preemption.
    spot = true

    service_account = google_service_account.gke_nodes.email
    # Paired with the custom service account above: access is controlled
    # by the IAM role granted to that service account, not by the OAuth
    # scope, so the broad cloud-platform scope is the documented,
    # recommended pairing here (see container_node_pool docs/examples).
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }

  # IAM propagation is eventually consistent (GKE hardening guide: nodes
  # using a service account without the right role can fail to register).
  # Without this, Terraform is free to create the node pool concurrently
  # with the IAM binding above, since neither's arguments reference the
  # other.
  depends_on = [google_project_iam_member.gke_nodes_default_sa]
}
