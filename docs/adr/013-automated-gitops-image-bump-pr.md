# ADR-013: CI opens a PR to bump the gitops image tag, human still merges

- Status: accepted
- Date: 2026-08-03
- Author: app-developer

## Context

Each service's `gitops/services/<service>/deployment.yaml` pins `image:` to
the exact `github.sha` of the `main` commit whose CI push job built and
pushed that image (`.github/workflows/service-ci.yml`'s `env.IMAGE` uses
`github.sha`, tags are immutable per commit). Nothing keeps that tag in sync
automatically, so it has to be bumped by hand after every merge that touches
`apps/<service>/`. This has already caused real follow-up work: Phase 5's
placeholder tags were fixed post-merge in PR #17, and Phase 6's
backend/worker tags are stale right now, pending this exact fix (see
`TASKS.md`'s Phase 5/6 log entries).

Three automation options were presented to the human operator:

1. CI directly commits the bump to `main`.
2. CI directly patches the live cluster / bypasses GitOps for this field.
3. CI opens a PR bumping the tag; a human still reviews and merges it.

Options 1 and 2 both cross `CLAUDE.md`'s explicit hard gate — "merging into
the branch watched by Argo CD" is never automated, and "GitOps only" rules
out anything reaching the cluster outside Git plus Argo CD reconciliation.
The human operator chose option 3.

## Decision

`service-ci.yml` gains a `bump-gitops` job, `needs: push` and gated by the
same `if: github.ref == 'refs/heads/main'` condition as `push` (so it never
runs for `pull_request` events — a fork's PR cannot reach it, since
`github.ref` there is the PR's merge ref, not `refs/heads/main`, and this
workflow is never invoked via `pull_request_target`). The job:

- Edits `gitops/services/<service>/deployment.yaml`'s `image:` tag to the
  `github.sha` just pushed by the `push` job.
- Commits to a stable, per-service branch (`ci/bump-<service>-image`),
  force-pushed each run so repeated CI runs update the same branch instead
  of piling up duplicates.
- Opens a PR via `gh pr create` if none is open for that branch yet
  (checked with `gh pr list --head <branch> --state open`), or updates the
  existing one's title/body via `gh pr edit` otherwise. Flags verified
  against `cli.github.com/manual/gh_pr_create` and `gh_pr_list` in this
  session.
- Runs with job-scoped `permissions: contents: write, pull-requests: write`
  (overriding the workflow-level `packages: write`, unneeded for this job) —
  the minimum GITHUB_TOKEN scopes GitHub's own docs document for pushing a
  branch and creating/editing a PR
  (`docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication`).

The job never merges the PR, never pushes to `main` directly, and never
enables GitHub's auto-merge. A human still clicks merge, same as every
other PR in this repo.

**Repo setting required, outside this workflow's control:** GitHub disables
"Allow GitHub Actions to create and approve pull requests" by default for
new repositories. Without enabling it (Settings -> Actions -> General ->
Workflow permissions), `gh pr create`/`gh pr edit` fail even with the
correct `permissions:` block above, because that toggle is a repository/org
policy setting, not a per-workflow permission. The human operator must
enable it once for this repo.

## Consequences

**Easier:** the stale-tag class of bug (Phase 5 PR #17, Phase 6's current
backend/worker staleness) cannot recur silently — every `main` push that
changes a service now produces a visible, reviewable PR the moment CI
finishes, instead of relying on a human remembering to hand-edit YAML.

**Harder:** one more moving part in `service-ci.yml`; a `bump-gitops` job
appearing to open a PR automatically could look surprising to a future
reader unless they know to check `docs/conventions.md`'s note on this flow.
The repo-level "create and approve pull requests" toggle is an
easy-to-forget one-time manual setup step outside this ADR's own file
changes.

**Accepted trade-off:** this still requires a human merge for every image
bump — deliberately, to preserve `CLAUDE.md`'s hard gate. If review fatigue
from four more routine PRs per phase becomes a real problem, revisit with a
narrower auto-merge policy restricted to gitops-only, tag-only diffs — not
before, per `docs/conventions.md`'s anti-speculation guidance.
