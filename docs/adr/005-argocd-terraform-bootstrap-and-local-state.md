# ADR-005: Argo CD Terraform bootstrap (kubeconfig-only providers, two-phase apply) and local state for `terraform/delivery/`

- Status: accepted
- Date: 2026-08-01
- Author: gitops-engineer

This ADR refines ADR-004 (local-first validation with Kind); it does not
supersede it. ADR-004 established that a local Kind cluster is the Phase
2-6 validation target and that shared code must stay cluster-agnostic. This
ADR records the two concrete mechanisms `terraform/delivery/` uses to honor
that, plus one accepted, temporary deviation from `docs/conventions.md`.

## Context

### Decision 1: how to keep the Argo CD bootstrap cluster-agnostic

`terraform/delivery/` must install Argo CD and apply the root Application
identically whether the target is the local Kind context
(`kind-cloud-native-lab`) or a future GKE context, per ADR-004. Both the
`hashicorp/helm` and `hashicorp/kubernetes` Terraform providers support
several authentication styles (kubeconfig file, explicit credentials,
`exec` plugins, in-cluster); `exec` plugins in particular are how
cloud-specific short-lived tokens (e.g. `aws eks get-token`,
`gcloud config config-helper`) are normally wired in, which would
reintroduce cloud-specific logic into a config that must stay generic.
(Sources: registry.terraform.io/providers/hashicorp/helm/latest/docs,
registry.terraform.io/providers/hashicorp/kubernetes/latest/docs.)

Applying the root Application itself requires either a native Argo CD
Terraform provider (none is official/HashiCorp-maintained) or the
`hashicorp/kubernetes` provider's generic `kubernetes_manifest` resource
reading the same YAML Argo CD itself would read. The current
`kubernetes_manifest` docs state plainly: "This resource requires API
access during planning time. This means the cluster has to be accessible
at plan time and thus cannot be created in the same apply operation"
(registry.terraform.io/providers/hashicorp/kubernetes/latest/docs/resources/manifest).
Since the Argo CD `Application` CRD is installed by the argo-cd Helm chart
in the same root module, a single `terraform apply` on a cluster with no
prior Argo CD install fails at plan time — `depends_on` orders execution
but does not make an unseen CRD visible to `plan`.

### Decision 2: local state for `terraform/delivery/`

`docs/conventions.md` requires "State in GCS with locking. Never local
state in the repository." No GCS bucket exists yet: `terraform/bootstrap/`
(which creates it) is code-complete but still behind the human `apply` gate
(TASKS.md). ADR-004 already treats the Kind target as ephemeral local dev,
not a durable environment worth remote-state guarantees. `.gitignore`
already excludes `*.tfstate*`, and `terraform/bootstrap` itself establishes
the precedent of a root starting on local state before a backend exists
(docs/adr/003-terraform-bootstrap-sequence.md).

## Decision

1. `terraform/delivery/providers.tf` configures both the `helm` and
   `kubernetes` providers using only `config_path` (kubeconfig file) and
   `config_context` (context name), sourced from `var.kubeconfig_path` /
   `var.kubeconfig_context`. No `exec` block, no cloud SDK calls, anywhere
   in the module or its `argocd` submodule. `var.kubeconfig_context` has no
   default — it is the one knob that changes between Kind and GKE.

   The root Application (`kubernetes_manifest.root_app`, built from
   `yamldecode(file("gitops/root-app.yaml"))`) is applied with
   `depends_on = [module.argocd]`. Because of the CRD-visibility-at-plan-time
   limitation above, `terraform/delivery/README.md` documents a mandatory
   two-phase apply: `terraform apply -target=module.argocd` first, then a
   plain `terraform apply` — the same two-step shape already documented in
   `terraform/bootstrap/README.md` (there, for a different reason: bucket
   must exist before its own backend can point at it).

2. `terraform/delivery/versions.tf` has no `backend` block. This is a
   deliberate, temporary exception to `docs/conventions.md`'s GCS-state
   rule, scoped to this root only, for the reasons in Context/Decision 2
   above. Once the ADR-004 GKE validation gate is exercised (i.e. once
   `terraform/bootstrap/` has actually been applied and a real state bucket
   exists), this root migrates to `backend "gcs" {}` with partial
   configuration, matching `terraform/foundation/versions.tf`'s pattern.

## Consequences

- Easier: the exact same `terraform/delivery/` code and README sequence
  works against Kind today and GKE later — validated genuinely, not just
  statically, per ADR-004's intent.
- Harder: every apply of this root requires two `terraform apply`
  invocations, not one — an easy step to forget; mitigated by writing the
  exact sequence in `terraform/delivery/README.md`.
- Local state for `terraform/delivery/` is a scoped, documented exception
  to `docs/conventions.md`, not a silent deviation — it must be revisited
  (migrated to GCS) at the ADR-004 GKE gate, not left indefinitely once a
  bucket exists.
- Anyone re-reading `terraform/delivery/versions.tf` must notice the
  comment explaining the missing backend block and the migration trigger;
  same class of manual-step risk already accepted in ADR-003 for
  `terraform/bootstrap/`.
