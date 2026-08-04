# ADR-018: ConfigMap-mounted DAG instead of git-sync

- Status: accepted
- Date: 2026-08-03
- Author: platform-engineer

## Context

The official Airflow Helm chart (1.22.0) documents three ways to get DAG
files onto every Airflow pod
(`https://raw.githubusercontent.com/apache/airflow/helm-chart/1.22.0/chart/values.yaml`,
`dags:` section):

1. `dags.gitSync.enabled` — a sidecar (`registry.k8s.io/git-sync/git-sync`)
   continuously clones/pulls a Git repo into a shared volume on every
   Airflow pod.
2. `dags.persistence.enabled` — a PersistentVolumeClaim the operator fills
   manually (`kubectl cp` or similar) — inherently NOT GitOps-declarative,
   ruled out immediately (`CLAUDE.md`: "GitOps only... nothing reaches the
   cluster via `kubectl apply` by hand").
3. Top-level `volumes`/`volumeMounts` ("for all Airflow containers") — any
   Kubernetes volume, including a plain `ConfigMap`.

This lab's `gitops/` repository is private (well, public per
`docs/adr/002-public-repo-for-branch-protection.md`, but git-sync still
needs credentials/deploy-key wiring for a private-feeling internal clone
path, SSH key or PAT management via `dags.gitSync.credentialsSecret`/
`sshKeySecret`) and a dedicated sync sidecar per Airflow pod, continuously
polling, for exactly ONE DAG file that changes at Git-commit cadence, not
runtime cadence.

A `ConfigMap` holding the one `sales_report_dag.py` file, applied by Argo
CD like every other manifest in `gitops/`, needs none of that: Argo CD's
own sync (already the mechanism delivering every other change in this
repo) IS the "sync" git-sync would otherwise provide, on the exact same
cadence as everything else — no extra sidecar process, no Git credentials
inside the cluster, no new secret to add to
`scripts/bootstrap-vault.sh`.

## Decision

A single `ConfigMap` (`gitops/data/airflow/dags-configmap.yaml`) mounted
via `gitops/apps/airflow.yaml`'s top-level `volumes`/`volumeMounts` (chart
values, "Volumes/VolumeMounts for all Airflow containers") at
`/opt/airflow/dags/sales_report_dag.py` (`subPath`), not `dags.gitSync`.

## Consequences

**Easier:** zero extra moving parts (no sidecar, no Git credential, no
`dags.persistence` PVC); DAG updates land exactly when Argo CD syncs
`gitops/`, same as everything else in this repo — one deployment story,
not two.

**Harder:** a `ConfigMap`'s 1MiB size limit
(https://kubernetes.io/docs/concepts/configuration/configmap/#motivation)
caps how much DAG code this approach scales to, and every DAG file must be
embedded as literal YAML text (no Python package structure, no shared
`dags/common/` modules across multiple DAG files) — acceptable for this
phase's single, self-contained DAG.

**Accepted trade-off:** if Phase 7 (or a later phase) ever needs multiple
DAGs sharing code, or DAG files large/numerous enough to strain the
ConfigMap size limit, `dags.gitSync` (with a deploy key scoped read-only to
this repo, added to `scripts/bootstrap-vault.sh` like every other
credential) is the natural next step — not adopted now because nothing in
this phase needs it yet (docs/conventions.md: "no speculative
abstraction").
