# ADR-006: Vault dev-mode for the lab, plus Kubernetes auth (not a static token) for ESO

- Status: accepted
- Date: 2026-08-01
- Author: security-engineer

## Context

Phase 3 (`docs/phases.md`) requires Vault + External Secrets Operator (ESO)
deployed via GitOps, wired so a test secret flows Vault -> ESO -> a pod's
environment variable. `docs/vision.md`'s non-goals explicitly exclude
"production hardening beyond sensible defaults", and `docs/conventions.md`
favors the simplest solution a junior engineer can read in one pass.

### Decision 1: dev-mode Vault

HashiCorp's own dev-server docs (developer.hashicorp.com/vault/docs/concepts/dev-server)
describe dev mode as: a single Vault server, in-memory storage, TLS
disabled, auto-initialized and auto-unsealed on start — "useful for
experimenting... do not use dev mode for anything other than
experimenting." The official Helm chart (`server.dev.enabled`,
developer.hashicorp.com/vault/docs/platform/k8s/helm/run) is the documented
way to run it in Kubernetes.

Alternatives considered:
1. **Standalone mode with a file backend (`server.standalone`)** — requires
   a PVC and a manual `vault operator init`/`unseal` flow (root keys must be
   captured and stored somewhere — in a public repo, nowhere safe exists for
   that today). Adds real operational weight (unseal after every restart)
   for a lab with no HA requirement and no production traffic.
2. **HA mode with Raft storage (`server.ha`)** — same init/unseal problem,
   plus multi-replica coordination this lab does not need (`docs/vision.md`
   non-goal: "High availability and multi-region setups").
3. **Dev mode** — zero init/unseal flow, matches the lab's actual
   requirement (prove the secret-flow mechanics), chosen.

### Decision 2: Kubernetes auth method for ESO, not a static Vault token

ESO's Vault provider docs (external-secrets.io/latest/provider/hashicorp-vault/)
document two ways to authenticate a `SecretStore` to Vault: a static token
in a Kubernetes `Secret` (`auth.tokenSecretRef`), or the Kubernetes auth
method (`auth.kubernetes`), where ESO exchanges a short-lived,
audience-scoped ServiceAccount token (via the TokenRequest API) for a Vault
token at `auth/kubernetes/login`. The token-based option requires a human
or a Job to first obtain a Vault token and store it as a cluster Secret —
functionally reintroducing exactly the credential-handling problem this ADR
is otherwise avoiding. The Kubernetes auth method needs no such Secret ever
to exist; only RBAC (`system:auth-delegator`, already the vault chart's
default) and a Vault-side role/policy (this repo's
`gitops/secrets-demo/README.md`, run once, manually — see below).

## Decision

1. Vault runs in dev mode (`gitops/apps/vault.yaml`,
   `server.dev.enabled: true`). No standalone/HA mode, no init/unseal flow,
   no persistent storage.
2. `gitops/secrets-demo/secretstore.yaml` authenticates to Vault via the
   Kubernetes auth method, never via a static token stored as a Kubernetes
   Secret.
3. The one-time Vault-side setup that only the root token can perform
   (enable `auth/kubernetes`, write the role/policy, seed the test KV
   value) is a **manual, documented bootstrap**
   (`gitops/secrets-demo/README.md`), not a GitOps-declared resource: it
   inherently needs the root token, and writing that token into any
   Git-tracked file — even a Job manifest — would violate the project's
   absolute no-secrets-in-git rule (`CLAUDE.md`, this repo is public per
   ADR-002). The token is retrieved from the pod's own runtime logs and
   used interactively; it never touches this repository.

## Consequences

**Production-hardening gap explicitly accepted for this lab** (must change
before any GKE/production use, per `docs/vision.md`'s non-goals and
ADR-004's local-first model):

- No high availability — a single Vault replica; a pod restart is an outage.
- No auto-unseal — moot in dev mode (auto-unsealed by design), but any
  future move to standalone/HA mode needs a real auto-unseal mechanism
  (e.g. GCP Cloud KMS) before that gap closes.
- No TLS — `tlsDisable: true` (chart default), all Vault traffic in
  cluster-internal plaintext HTTP.
- In-memory storage, no persistence — **all secrets are lost on every pod
  restart**, including the Kubernetes-auth role/policy and the test KV
  value; the manual bootstrap in `gitops/secrets-demo/README.md` must be
  re-run after any Vault pod restart.

Why acceptable now: ADR-004 already treats the Kind cluster as an ephemeral,
local-first validation target, not a durable environment; Phase 3's exit
gate only requires proving the secret-flow mechanics work, not durability.

Easier: no unseal-key management burden for a solo lab operator; the
Kubernetes auth method means zero Vault credentials ever exist as
Kubernetes Secrets or Git-tracked files, which is a strictly stronger
posture than the token-based alternative even at dev-mode scale.

Harder: every environment rebuild (new Kind cluster, or any Vault pod
restart) requires re-running the manual bootstrap — an easy step to forget;
mitigated by documenting the exact commands and by the exit-gate
verification checklist in `gitops/secrets-demo/README.md` failing loudly
(`ExternalSecret` reports an error, `secret-consumer` pod CrashLoopBackOffs)
if it is skipped.

Before any GKE/production use: replace dev mode with a supported
production topology (Raft HA storage + auto-unseal via cloud KMS + TLS),
and re-run the Kubernetes-auth setup declaratively against the real
`kubernetes_host`/CA for that cluster.
