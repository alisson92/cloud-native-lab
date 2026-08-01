# Conventions

## Language

- English everywhere: code, file and directory names, comments, commit
  messages, documentation, ADRs, task descriptions. No exceptions.

## Repository bootstrap (before any code is generated)

- `.gitignore` must exist before the first commit, and it must be scoped to
  the **full** stack declared in `docs/vision.md`/`docs/architecture.md`
  (Terraform, Python, Node/JS, Kubernetes/Helm, secrets/env files) — not
  only the files present at the time. Read those docs first, then write the
  ignore rules for every stack that will eventually land, so nobody has to
  patch the file reactively once Terraform, the apps, or Airflow show up.
  Always include OS and editor artifacts (`.vscode/`, `.idea/`,
  `.DS_Store`, `Thumbs.db`) and, on WSL, `*:Zone.Identifier`.
- The branch Argo CD watches (`main`) must have branch protection enabled
  — require PR before merge, enforce for admins, no force-push, no branch
  deletion — **before** any agent starts generating code against the repo.
  This is a prerequisite of Phase 1, even though it is not a line item in
  `TASKS.md`. If the hosting plan cannot protect a private repository, that
  trade-off is decided with the human operator and recorded as an ADR (see
  `docs/adr/002-public-repo-for-branch-protection.md`) — never leave `main`
  unprotected silently.

## Git

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
  `ci:`), imperative mood, in English.
- Small, atomic commits. One logical change per commit.
- Branch naming: `phase-<n>/<short-topic>` (e.g. `phase-1/vpc-module`).
- The branch watched by Argo CD is protected: agents open changes against it
  but never merge (human gate).

## Grounding in official documentation

- Before writing configuration for any tool, consult its official
  documentation (use WebFetch/WebSearch on official domains:
  `developer.hashicorp.com`, `cloud.google.com`, `argo-cd.readthedocs.io`,
  `strimzi.io`, `cloudnative-pg.io`, `airflow.apache.org`, etc.).
- If official docs and memory disagree, the docs win.
- Reference the doc page used in the PR/commit description when the decision
  is non-obvious.
- Never invent flags, fields, chart values, or API versions. If it cannot be
  verified, it does not ship.

## Simplicity (anti-over-engineering)

- Excellence does not require complexity. The simplest solution that meets
  the requirement wins.
- No speculative abstraction: do not build for hypothetical future needs.
- Prefer defaults from official docs over custom tuning without a measured
  reason.
- Prefer plain manifests over a Helm chart when templating adds nothing.
- Every module/service must be understandable by a junior engineer in one
  reading. If it is not, simplify before merging.
- Delete code and config that is not used. Dead weight is a defect.

## Terraform

- Style and structure follow the official HashiCorp style guide.
- Always `terraform fmt` and `terraform validate` before committing.
- `terraform plan` output is attached to the task before requesting the
  human gate. Dry-run before anything destructive, always.
- State in GCS with locking. Never local state in the repository.

## Kubernetes / GitOps

- Everything under `gitops/` is declarative and reconciled by Argo CD.
- No `kubectl apply`, `kubectl edit`, or `helm install` by hand against the
  cluster. Read-only `kubectl` (get/describe/logs) is allowed for diagnosis.
- Resource requests/limits set for every workload (cost discipline).

## Documentation

- Every phase updates the docs it touches. Docs that lie are worse than no
  docs.
- Architectural decisions go to `docs/adr/` using the format:
  `NNN-short-title.md` with Context / Decision / Consequences.
