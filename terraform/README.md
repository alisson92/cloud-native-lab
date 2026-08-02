# Terraform

Three root modules plus a shared module library. `bootstrap`/`foundation`
target GCP and apply in order; `delivery` targets whatever Kubernetes
cluster `var.kubeconfig_context` points at (local Kind today, GKE later —
see `docs/adr/004-local-first-validation-with-kind.md`) and can be applied
independently of the GCP roots.

```
terraform/
  bootstrap/    # budget alert -> GCS state bucket (local state, then migrated). Apply first, once.
  foundation/   # VPC + GKE, backed by the GCS bucket bootstrap created. Apply second.
  delivery/     # Argo CD + app-of-apps root Application, cluster-agnostic (kubeconfig-only providers).
  modules/
    budget-alert/
    vpc/
    gke/
    argocd/
```

## Apply order

0. **One-time per GCP project, before step 1**: enable the Cloud Resource
   Manager API manually (`gcloud services enable cloudresourcemanager.googleapis.com`)
   — Terraform cannot self-enable it on a cold project. See
   `terraform/bootstrap/README.md`'s "Prerequisite" section before running
   anything below.
1. `terraform/bootstrap/` — see its `README.md` for the exact one-time
   local-state-to-GCS sequence. Creates the budget alert (must be the
   first billable resource ever created, per `docs/phases.md`) and the
   Terraform state bucket, in that order.
2. `terraform/foundation/` — `terraform init -backend-config=backend.gcs.tfbackend`
   (copy `backend.gcs.tfbackend.example` first), then `plan`/`apply`
   against the bucket from step 1.
3. `terraform/delivery/` — see its `README.md` for the required two-phase
   apply (`-target=module.argocd` first, then a plain `apply`; the Argo CD
   `Application` CRD must exist before `kubernetes_manifest.root_app` can
   be planned). `var.kubeconfig_context` selects the target cluster:
   `kind-cloud-native-lab` for local dev now, a GKE context string once
   step 2 has actually been applied.

Why the ordering is designed this way, and what alternatives were
rejected: `docs/adr/003-terraform-bootstrap-sequence.md` (bootstrap/
foundation) and `docs/adr/005-argocd-terraform-bootstrap-and-local-state.md`
(delivery).

## Conventions used throughout

- No project-specific value (`project_id`, billing account, bucket names)
  has a default — always passed via `-var`, a gitignored `terraform.tfvars`,
  or `-backend-config`.
- `terraform fmt` and `terraform validate` are run before every commit.
- Every non-trivial resource/argument is grounded in a comment citing the
  official doc page consulted.
