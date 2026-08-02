Per-service Argo CD Application manifests land here starting Phase 3.

First examples (Phase 3, Secrets): `vault.yaml` and `external-secrets.yaml`
— both Helm-chart-sourced Applications (`source.chart` pointing at the
official upstream repo, not a local git path). See
`docs/adr/006-vault-dev-mode-for-lab.md` for the Vault dev-mode trade-off.
The actual Vault<->ESO wiring (`SecretStore`, `ExternalSecret`, test
workload) is plain manifests under `gitops/secrets-demo/`, reconciled
directly by `root-app`'s recursion rather than through a dedicated child
Application — see that directory's `README.md`.
