# ADR-002: Public repository to enable branch protection on GitHub Free

- Status: accepted
- Date: 2026-08-01
- Author: orchestrator

## Context

The project's non-negotiable rules require a human gate on merges to the
branch Argo CD watches (`main`), enforceable at the platform level through
GitHub branch protection (require PR before merge, no force-push, no
deletion, enforced for admins).

GitHub Free does not support branch protection rules on private
repositories — only on public repositories, or on private repositories
under GitHub Pro/Team/Enterprise. This was confirmed directly against the
GitHub REST API: `PUT /repos/{owner}/{repo}/branches/main/protection`
returned `403` with `"Upgrade to GitHub Pro or make this repository public
to enable this feature"` when first attempted on the private
`alisson92/devops-lab-kit` repository.

Alternatives considered:
1. Upgrade to GitHub Pro — adds a recurring cost to a project whose
   `CLAUDE.md` explicitly mandates cost discipline.
2. Keep the repository private and skip branch protection — leaves `main`
   unprotected, contradicting the human-gate rule.
3. Make the repository public.

## Decision

Made `alisson92/devops-lab-kit` public and enabled branch protection on
`main`: require PR before merge, enforce for admins, no force-push, no
branch deletion. Required approving review count set to `0` for now (solo
repository) — raise it if collaborators join.

## Consequences

- Everything pushed to the repository is publicly visible immediately.
  `.gitignore` coverage and the "no secret ever lands in Git" rule (see
  `docs/conventions.md` and Phase 3 in `docs/phases.md`) become strict
  prerequisites, not best-effort — there is no private fallback if a secret
  slips through.
- No recurring cost from a paid GitHub plan.
- If the project later needs to go private again (e.g. before secrets
  handling matures, or for any other reason), branch protection must be
  re-evaluated: either accept an unprotected private repo, or upgrade to
  GitHub Pro/Team at that point.
