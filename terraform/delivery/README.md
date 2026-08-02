# Delivery

Installs Argo CD (`module.argocd`, a pinned Helm chart) and applies the
app-of-apps root Application (`kubernetes_manifest.root_app`, built from
`gitops/root-app.yaml`), so Argo CD starts reconciling everything under
`gitops/` right after bootstrap.

Cluster-agnostic by design (`docs/adr/004-local-first-validation-with-kind.md`):
the `helm` and `kubernetes` providers are configured only from a kubeconfig
path + context (`providers.tf`). The same code applies unchanged to the
local Kind cluster today and to GKE later — only `kubeconfig_context`
changes.

## Prerequisite

A reachable cluster and matching kubeconfig context. For the local target:

```sh
kind create cluster --config ../../local/kind/kind-config.yaml
```

produces context `kind-cloud-native-lab` (see `local/kind/README.md`).

## Apply sequence (two-phase, required)

`kubernetes_manifest.root_app` targets the Argo CD `Application` CRD, which
is installed by the argo-cd Helm chart in the same apply. The
`hashicorp/kubernetes` provider's `kubernetes_manifest` resource requires
that CRD to already exist at **plan** time (documented limitation:
"cannot be created in the same apply operation" —
https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/resources/manifest).
`depends_on` alone only orders the apply, not the plan, so a single
`terraform apply` fails on a cluster with no prior Argo CD install. Apply in
two steps, same shape as `terraform/bootstrap/README.md`'s documented
sequence:

```sh
cd terraform/delivery
terraform init

# Phase 1: install Argo CD only (creates the Application CRD).
terraform apply -target=module.argocd \
  -var="kubeconfig_context=kind-cloud-native-lab" \
  -var="argocd_chart_version=10.2.2" \
  -var="gitops_repo_url=https://github.com/alisson92/cloud-native-lab.git"

# Phase 2: now the CRD exists, plan/apply can see it — apply the rest
# (the root Application).
terraform apply \
  -var="kubeconfig_context=kind-cloud-native-lab" \
  -var="argocd_chart_version=10.2.2" \
  -var="gitops_repo_url=https://github.com/alisson92/cloud-native-lab.git"
```

Put repeated `-var` values in a gitignored `terraform.tfvars` instead if
preferred.

## Targeting Kind vs. a future GKE cluster

Only `kubeconfig_context` changes:

- Local Kind (now): `kind-cloud-native-lab` (created by
  `local/kind/kind-config.yaml`).
- GKE (later, once the ADR-004 validation gate is exercised): the context
  name `gcloud container clusters get-credentials` writes to your
  kubeconfig for the cluster from `terraform/foundation/`.

## Verifying the exit gate

```sh
kubectl --context kind-cloud-native-lab get application -n argocd root-app
```

Phase 2's exit gate (`docs/phases.md`) is met once `root-app` shows
`Synced`/`Healthy`.

## State

This root uses local Terraform state, not GCS, as a deliberate temporary
exception — see `docs/adr/005-argocd-terraform-bootstrap-and-local-state.md`
and the comment in `versions.tf`. Never commit `*.tfstate*` (already
excluded by `.gitignore`).
