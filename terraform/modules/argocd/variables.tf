variable "namespace" {
  description = "Kubernetes namespace to install Argo CD into. No default: passed from the root module (cluster-agnostic, no assumption about the target)."
  type        = string
}

variable "chart_version" {
  description = "Pinned version of the argo-cd Helm chart (argoproj/argo-helm). No default: must be an explicit, doc-verified choice made by the root module, per docs/conventions.md (\"never invent flags, chart values\")."
  type        = string
}
