terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # No backend block here on purpose: the very first `terraform init` /
  # `apply` in this directory must run on the implicit local backend,
  # because the resource being created is the GCS bucket state will later
  # live in (can't point state at a bucket that doesn't exist yet).
  #
  # Once `terraform apply` has created the bucket, uncomment the block
  # below and run:
  #   terraform init -backend-config=backend.gcs.tfbackend -migrate-state
  # (copy backend.gcs.tfbackend.example to backend.gcs.tfbackend first and
  # fill in the real bucket name).
  #
  # See README.md in this directory and
  # docs/adr/003-terraform-bootstrap-sequence.md for the full sequence and
  # rationale.
  #
  # backend "gcs" {}
}
