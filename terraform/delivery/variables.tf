variable "kubeconfig_path" {
  # `~` here is expanded by the providers themselves (both the helm and
  # kubernetes provider docs use "~/.kube/config" directly as config_path),
  # not by Terraform: variable defaults cannot call functions like
  # pathexpand(), so the literal default below relies on that provider
  # behavior instead.
  description = "Path to the kubeconfig file used by both the helm and kubernetes providers."
  type        = string
  default     = "~/.kube/config"
}

variable "kubeconfig_context" {
  description = "Kubeconfig context to target. No default: this is the cluster-agnostic knob — `kind-cloud-native-lab` for the local Kind cluster now, a GKE context string later (docs/adr/004-local-first-validation-with-kind.md)."
  type        = string
}

variable "argocd_namespace" {
  description = "Namespace to install Argo CD into."
  type        = string
  default     = "argocd"
}

variable "argocd_chart_version" {
  description = "Pinned argo-cd Helm chart version. No default: must be an explicit, doc-verified choice (see terraform/modules/argocd/main.tf for the source consulted)."
  type        = string
}

variable "gitops_repo_url" {
  description = "Git URL of this repository, used as the root Application's source.repoURL. No default: passed explicitly since it is repo-specific."
  type        = string
}

variable "gitops_repo_revision" {
  description = "Git revision (branch) the root Application tracks."
  type        = string
  default     = "main"
}
