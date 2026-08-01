variable "project_id" {
  description = "GCP project ID to create the cluster in."
  type        = string
}

variable "zone" {
  description = "Zone for the cluster's single control plane and its node pool. Zonal (not regional) keeps the control plane free/cheap and matches the lab's non-HA scope (see docs/vision.md non-goals)."
  type        = string
  default     = "us-central1-a"
}

variable "cluster_name" {
  description = "Name of the GKE cluster."
  type        = string
  default     = "cloud-native-lab"
}

variable "network" {
  description = "Self link/ID of the VPC network (from the vpc module)."
  type        = string
}

variable "subnetwork" {
  description = "Self link/ID of the subnetwork (from the vpc module)."
  type        = string
}

variable "pods_range_name" {
  description = "Name of the subnetwork's secondary range for Pod IPs (from the vpc module)."
  type        = string
}

variable "services_range_name" {
  description = "Name of the subnetwork's secondary range for Service ClusterIPs (from the vpc module)."
  type        = string
}

variable "node_machine_type" {
  description = "Machine type for the Spot node pool. e2-medium (2 vCPU/4GB) is sized for Phases 1-3 (cluster bootstrap, Argo CD, Vault/ESO); revisit before Phase 5/6 adds real application and data workloads (Postgres, Redis, RabbitMQ, Kafka, Airflow)."
  type        = string
  default     = "e2-medium"
}

variable "node_disk_size_gb" {
  description = "Boot disk size per node, in GB."
  type        = number
  default     = 30
}

variable "min_node_count" {
  description = "Minimum node count for the Spot pool's autoscaler (per zone)."
  type        = number
  default     = 1
}

variable "max_node_count" {
  description = "Maximum node count for the Spot pool's autoscaler (per zone). Bounded to cap worst-case cost."
  type        = number
  default     = 2
}
