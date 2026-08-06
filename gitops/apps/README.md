Infra Argo CD Application manifests: `vault.yaml`, `external-secrets.yaml`,
`cloudnativepg-operator.yaml` — all Helm-chart-sourced (`source.chart`
pointing at the official upstream repo, not a local git path). See `docs/adr/006-vault-dev-mode-for-lab.md` for the original Vault
dev-mode trade-off and `docs/adr/022-vault-standalone-file-storage.md` for
the storage decision that later superseded it (standalone mode, `file`
backend, persistent PVC — Decision 1 only; ADR-006's Decision 2, the
Kubernetes auth method for ESO, still stands).

This directory does NOT hold per-service application workload manifests
(backend/BFF/frontend/worker Deployments, Services, etc.) — those live under
`gitops/services/` (Phase 5 onward), reconciled directly by `root-app`'s
recursion rather than through a dedicated child Application, following the
same pattern as `gitops/data/` and `gitops/secrets-demo/`. See
`gitops/services/README.md`.
