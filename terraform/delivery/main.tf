# Delivery root: installs Argo CD, then applies the app-of-apps root
# Application from gitops/root-app.yaml so Argo CD starts reconciling
# gitops/ immediately after bootstrap. Cluster target (Kind now, GKE later)
# is controlled entirely by the provider configuration in providers.tf —
# nothing cluster-specific lives here.

module "argocd" {
  source = "../modules/argocd"

  namespace     = var.argocd_namespace
  chart_version = var.argocd_chart_version
}

# gitops/root-app.yaml is the single source of truth for the Application
# spec (also what a human/Argo CD itself would read directly from Git).
# repoURL/targetRevision are overridden from variables here so this root
# can point Terraform's own apply at a fork or a different branch without
# editing the checked-in manifest, while every other field (destination,
# syncPolicy, directory.recurse) is taken as-is from the file.
locals {
  root_app_manifest = yamldecode(file("${path.module}/../../gitops/root-app.yaml"))
}

# NOTE on ordering: `kubernetes_manifest` requires the target's API/CRD to
# already exist at PLAN time (confirmed in the current provider docs:
# https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/resources/manifest
# — "This resource requires API access during planning time... cannot be
# created in the same apply operation"). The Application CRD is installed
# by the argo-cd Helm chart in `module.argocd`, so it cannot exist yet on a
# fresh cluster's first `terraform plan`. `depends_on` orders the *apply*
# correctly but does not help *plan* see the CRD. This root therefore needs
# a two-phase apply — see README.md — mirroring the same
# apply-before-plan-can-see-it shape already documented in
# terraform/bootstrap/README.md for a different (GCS backend) reason.
resource "kubernetes_manifest" "root_app" {
  manifest = merge(local.root_app_manifest, {
    spec = merge(local.root_app_manifest.spec, {
      source = merge(local.root_app_manifest.spec.source, {
        repoURL        = var.gitops_repo_url
        targetRevision = var.gitops_repo_revision
      })
    })
  })

  depends_on = [module.argocd]
}
