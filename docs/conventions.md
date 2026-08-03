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

## Secret scanning (pre-commit)

- This repo ships a `.pre-commit-config.yaml` running
  [gitleaks](https://github.com/gitleaks/gitleaks) on every commit, as a
  mechanical guardrail for the absolute no-secrets-in-git rule.
- One-time setup: `pip install pre-commit && pre-commit install` (run from
  the repo root). After that, gitleaks scans staged changes automatically
  on every `git commit`.
- Run it on demand against the whole repo with `pre-commit run --all-files`.
- `SKIP=gitleaks git commit ...` bypasses the hook for a false positive;
  use sparingly and never to bypass a real secret.

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
- **`root-app.yaml` sync-policy/prune-scope changes require a pre-merge
  diff check.** Any change touching `gitops/root-app.yaml`'s
  `syncPolicy` (`automated.prune`, `automated.selfHeal`) or
  `spec.source.directory` (`recurse`, `exclude`) must be verified against
  the live cluster *before* merging with `argocd app diff root-app
  --local=gitops` (run from the repo root; diffs the live `root-app`
  against the branch's local `gitops/` tree, including its managed
  resource list) or, if the Argo CD CLI isn't available, `kubectl diff -f
  gitops/root-app.yaml`. The specific failure
  this catches: removing a resource that `prune: true` is already tracking
  self-deletes it on the next automated sync — see
  `docs/adr/014-exclude-root-app-from-self-recursion.md`'s Consequences
  for the incident this rule exists because of.
  (`argocd app diff` reference:
  https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app_diff/
  — `--local` takes a local manifest path and diffs it against the live
  app; combine with `--local-repo-root` if the repo root and `--local`
  path differ.)

## Documentation

- Every phase updates the docs it touches. Docs that lie are worse than no
  docs.
- Architectural decisions go to `docs/adr/` using the format:
  `NNN-short-title.md` with Context / Decision / Consequences.

## Pre-review self-check (mandatory before requesting review)

A review round costs two full context reloads — the most expensive event in
this project. Owners request review ONLY after every box below passes:

- [ ] Formatters and validators ran clean in this session (`terraform fmt`
      + `validate`, linters, tests as applicable) — outputs included in the
      task notes or PR description.
- [ ] Every non-default value and every non-obvious flag has a comment with
      its doc-grounded reason. No invented arguments: anything not verified
      against official docs in this session was removed or verified now.
- [ ] Claims in the task notes match what was actually verified — no
      "confirmed" without a fetched source.
- [ ] English only; Conventional Commits; no secrets (grep the diff for
      obvious patterns before committing).
- [ ] ADR written if alternatives were weighed; TASKS.md entry is within
      the 10-line limit.
