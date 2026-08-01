# Terraform

Two root modules, applied in order, plus a shared module library.

```
terraform/
  bootstrap/    # budget alert -> GCS state bucket (local state, then migrated). Apply first, once.
  foundation/   # VPC + GKE, backed by the GCS bucket bootstrap created. Apply second.
  modules/
    budget-alert/
    vpc/
    gke/
```

## Apply order

1. `terraform/bootstrap/` — see its `README.md` for the exact one-time
   local-state-to-GCS sequence. Creates the budget alert (must be the
   first billable resource ever created, per `docs/phases.md`) and the
   Terraform state bucket, in that order.
2. `terraform/foundation/` — `terraform init -backend-config=backend.gcs.tfbackend`
   (copy `backend.gcs.tfbackend.example` first), then `plan`/`apply`
   against the bucket from step 1.

Why the ordering is designed this way, and what alternatives were
rejected: `docs/adr/003-terraform-bootstrap-sequence.md`.

## Conventions used throughout

- No project-specific value (`project_id`, billing account, bucket names)
  has a default — always passed via `-var`, a gitignored `terraform.tfvars`,
  or `-backend-config`.
- `terraform fmt` and `terraform validate` are run before every commit.
- Every non-trivial resource/argument is grounded in a comment citing the
  official doc page consulted.
