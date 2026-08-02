output "release_name" {
  description = "Name of the helm_release resource for Argo CD."
  value       = helm_release.argocd.name
}

output "namespace" {
  description = "Namespace Argo CD was installed into."
  value       = helm_release.argocd.namespace
}
