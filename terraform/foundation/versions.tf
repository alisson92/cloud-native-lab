terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # Partial configuration on purpose: no project-specific value (bucket
  # name) is hardcoded in version-controlled code. Initialize with:
  #   terraform init -backend-config=backend.gcs.tfbackend
  # (copy backend.gcs.tfbackend.example first). The bucket must already
  # exist — see terraform/bootstrap/README.md.
  backend "gcs" {}
}
