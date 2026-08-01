variable "project_id" {
  description = "GCP project ID. No default: this must never be hardcoded (it is environment-specific)."
  type        = string
}

variable "region" {
  description = "Region for the VPC subnetwork and the provider default."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Zone for the zonal GKE cluster and its node pool."
  type        = string
  default     = "us-central1-a"
}

variable "cluster_name" {
  description = "Name of the GKE cluster."
  type        = string
  default     = "cloud-native-lab"
}

variable "node_machine_type" {
  description = "Machine type for the Spot node pool."
  type        = string
  default     = "e2-medium"
}

variable "min_node_count" {
  description = "Minimum node count for the Spot pool's autoscaler."
  type        = number
  default     = 1
}

variable "max_node_count" {
  description = "Maximum node count for the Spot pool's autoscaler."
  type        = number
  default     = 2
}
