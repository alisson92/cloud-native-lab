# ADR-014: Exclude root-app.yaml from its own directory recursion

- Status: accepted
- Date: 2026-08-03
- Author: gitops-engineer

## Context

`gitops/root-app.yaml` uses `spec.source.directory.recurse: true` over the
whole `gitops/` tree, and its own manifest lives inside that same tree.
Live investigation (`kubectl -n argocd get application root-app -o json`)
confirmed `Application/argocd/root-app` appears in `root-app`'s own
`.status.resources[]` — a self-referential app-of-apps.

This was investigated as a possible cause of a live `Synced`/`Degraded`
incident on the Kind cluster. It was ruled out: the actual cause was a
Vault dev-mode pod restart wiping the Kubernetes auth method (`scripts/
bootstrap-vault.sh`'s documented failure mode), which genuinely degraded 8
ExternalSecret/SecretStore resources — confirmed via `argocd app get
root-app --core` showing real `HEALTH: Degraded` rows, and via
`external-secrets` controller logs (`403 permission denied` on Vault
Kubernetes-auth login). A manual `argocd app sync root-app --core` did not
clear the Degraded status, as expected once the cause was known to be a
live secret-provider failure, not a stale cache/self-reference artifact.

Still, per docs/conventions.md ("official docs drive design"), the
self-reference itself is worth fixing: Argo CD's own "Cluster
Bootstrapping" guide's app-of-apps example never stores the root
Application's manifest inside the directory it recurses into (the guide
applies the root app from outside that directory). `directory.exclude` is
a documented field of the Directory source type
(argo-cd.readthedocs.io/en/stable/user-guide/application-specification/)
built for exactly this kind of exclusion.

## Decision

Add `exclude: 'root-app.yaml'` to `gitops/root-app.yaml`'s
`spec.source.directory`, so root-app never tracks itself as a managed
resource. This matches the documented app-of-apps pattern and removes an
unnecessary (if currently benign) circular self-tracking edge case —
without changing `recurse: true` or any other behavior for the rest of
`gitops/`.

## Consequences

- Easier: `root-app`'s resource tree only ever lists resources it actually
  delivers, matching the documented pattern; one less confusing entry when
  reading `kubectl get application root-app -o json` or the Argo CD UI.
- Harder: none identified — `root-app.yaml` is applied once by
  `terraform/delivery/` (ADR-005), never by Argo CD itself, so excluding it
  from recursion changes nothing about how it reaches the cluster.
- No change to the actual Degraded-health incident this was investigated
  alongside; that root cause is Vault dev-mode state loss, tracked
  separately (fix: re-run `scripts/bootstrap-vault.sh`, owned by
  security-engineer, outside gitops-engineer's scope).
