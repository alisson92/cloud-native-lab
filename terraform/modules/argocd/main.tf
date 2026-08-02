# Installs Argo CD via its official Helm chart. Plain `helm_release`, no
# custom `values`/`set` blocks: the chart's own defaults satisfy Phase 2's
# exit gate ("root app synced and healthy" — docs/phases.md), and
# docs/conventions.md prefers defaults over custom tuning without a measured
# reason. Add overrides here only when a later phase documents a concrete
# need.
#
# Chart version pinned to 10.2.2 (packages Argo CD v3.4.6), the latest
# stable release at the time this module was written, confirmed against:
# - https://artifacthub.io/packages/helm/argo/argo-cd (ArtifactHub API:
#   version 10.2.2, app_version v3.4.6)
# - https://github.com/argoproj/argo-helm/releases (tag argo-cd-10.2.2)
# passed in from the root module as `var.chart_version` rather than
# hardcoded here, so a version bump stays a one-line root-level change.
#
# Docs consulted:
# - https://registry.terraform.io/providers/hashicorp/helm/latest/docs/resources/release
# - https://argo-cd.readthedocs.io/en/stable/operator-manual/installation/#helm
resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = var.chart_version
  namespace  = var.namespace

  # Lets this single resource own namespace creation, avoiding a separate
  # kubernetes_namespace resource for a one-namespace install.
  create_namespace = true
}
