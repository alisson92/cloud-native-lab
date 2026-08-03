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
- Harder — **this fix caused a live incident, discovered after merge**:
  `gitops/root-app.yaml` already had `syncPolicy.automated.prune: true`,
  and `root-app` was already self-tracking `Application/argocd/root-app`
  in its own `.status.resources[]` (confirmed live before this PR, see
  Context above). Adding `directory.exclude: 'root-app.yaml'` removed that
  resource from the git-desired set on the very next automated sync. With
  `prune: true` active, Argo CD correctly (per its own semantics) pruned
  the no-longer-desired resource — which was `root-app`'s own `Application`
  object. Argo CD self-deleted its top-level Application.
  - Impact, all confirmed live: no cascade deletion of child
    resources — `root-app` had no
    `resources-finalizer.argocd.argoproj.io` finalizer, so every workload
    Deployment/Secret/namespace kept running throughout (`kubectl get pod
    -A` all `Running`, `kubectl get ns` all `Active`). Argo CD stopped
    reconciling all of `gitops/` (no `root-app` Application existed) until
    the human operator ran `kubectl apply -f gitops/root-app.yaml` to
    recreate it — a one-time bootstrap-equivalent action, not a
    CLAUDE.md-gated `apply`/merge. `root-app` reached `Synced`/`Healthy`
    again within ~15s of recreation and no longer self-references (
    `Application/argocd/root-app` no longer appears in its own
    `.status.resources[]`).
  - Root cause of the miss: removing a resource a `prune: true` app is
    already tracking is a textbook GitOps self-prune trap, and it was
    foreseeable directly from the diff (the PR's own description already
    stated the self-tracking fact) without needing to touch the live
    cluster. This should have been caught by a `kubectl diff` / `argocd
    app diff --local` before merge. `docs/conventions.md` now requires
    this check for any future change to `root-app.yaml`'s `syncPolicy` or
    `spec.source.directory` settings.
- No change to the actual Degraded-health incident this was investigated
  alongside; that root cause is Vault dev-mode state loss, tracked
  separately (fix: re-run `scripts/bootstrap-vault.sh`, owned by
  security-engineer, outside gitops-engineer's scope).
