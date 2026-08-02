output "argocd_namespace" {
  description = "Namespace Argo CD was installed into."
  value       = module.argocd.namespace
}

output "root_application_name" {
  description = "Name of the root (app-of-apps) Argo CD Application."
  value       = kubernetes_manifest.root_app.object.metadata.name
}
