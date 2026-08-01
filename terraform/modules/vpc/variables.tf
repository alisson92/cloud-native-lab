variable "project_id" {
  description = "GCP project ID to create the network and subnetwork in."
  type        = string
}

variable "region" {
  description = "Region for the single subnetwork. Regional (not multi-region) to keep storage/networking cost minimal."
  type        = string
  default     = "us-central1"
}

variable "network_name" {
  description = "Name of the custom-mode VPC network."
  type        = string
  default     = "cloud-native-lab-vpc"
}

variable "subnet_name" {
  description = "Name of the single subnetwork."
  type        = string
  default     = "cloud-native-lab-subnet"
}

variable "subnet_cidr" {
  description = "Primary IP range for GKE nodes."
  type        = string
  default     = "10.10.0.0/20"
}

variable "pods_range_name" {
  description = "Name of the secondary range reserved for GKE Pod IPs (VPC-native cluster)."
  type        = string
  default     = "gke-pods"
}

variable "pods_cidr" {
  description = "Secondary IP range for GKE Pods. Sized larger than the node/service ranges because every node gets its own Pod CIDR slice."
  type        = string
  default     = "10.20.0.0/14"
}

variable "services_range_name" {
  description = "Name of the secondary range reserved for GKE Service ClusterIPs (VPC-native cluster)."
  type        = string
  default     = "gke-services"
}

variable "services_cidr" {
  description = "Secondary IP range for GKE Service ClusterIPs."
  type        = string
  default     = "10.30.0.0/20"
}
