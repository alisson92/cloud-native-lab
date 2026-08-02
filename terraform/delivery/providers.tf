# Both providers are configured ONLY from a kubeconfig file path + context
# name — no `exec` blocks, no cloud-specific auth logic. This is what keeps
# this root cluster-agnostic (docs/adr/004-local-first-validation-with-kind.md):
# the exact same code targets the local Kind context today
# (`kind-cloud-native-lab`) and a GKE context later, by only changing
# `var.kubeconfig_context`.
#
# Docs consulted (the "kubeconfig file" config style, not exec/in-cluster):
# - https://registry.terraform.io/providers/hashicorp/helm/latest/docs
#   (provider "helm" { kubernetes = { config_path = ..., config_context = ... } })
# - https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs
#   (provider "kubernetes" { config_path = ..., config_context = ... })

provider "helm" {
  kubernetes = {
    config_path    = var.kubeconfig_path
    config_context = var.kubeconfig_context
  }
}

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kubeconfig_context
}
