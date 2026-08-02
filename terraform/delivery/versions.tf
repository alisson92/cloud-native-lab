terraform {
  # Matches the required_version already used in terraform/bootstrap and
  # terraform/foundation.
  required_version = ">= 1.9.0"

  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.0"
    }
  }

  # No backend block here, on purpose (temporary exception to
  # docs/conventions.md's "state in GCS" rule): this root targets a local
  # Kind cluster today, per docs/adr/004-local-first-validation-with-kind.md,
  # and no GCS bucket exists yet to hold its state (Phase 1's
  # `terraform/bootstrap/` apply is itself still behind the human gate —
  # see TASKS.md). `.gitignore` already excludes `*.tfstate*`, and
  # `terraform/bootstrap` already establishes the precedent of a root
  # starting on local state before a backend exists. Full rationale in
  # docs/adr/005-argocd-terraform-bootstrap-and-local-state.md.
  #
  # Once the ADR-004 GKE validation gate is exercised (a real GCS bucket
  # exists from terraform/bootstrap), migrate this root to
  # `backend "gcs" {}` with partial configuration, matching
  # terraform/foundation/versions.tf.
}
