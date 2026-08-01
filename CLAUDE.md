# Project: cloud-native-lab

## Mission

Build a realistic, production-grade cloud-native lab on GCP/GKE: a simplified
e-commerce order platform (frontend, BFF, backend) with PostgreSQL, Redis,
RabbitMQ, Kafka, Airflow, and Vault — provisioned with Terraform and delivered
exclusively through GitOps (Argo CD).

The full context lives in `docs/`. Read it. It is the single source of truth.

## Operating model

- This main session acts as the **orchestrator**: it plans, delegates to
  subagents, evaluates results, and updates the plan. It does not implement.
- Work is delegated to the subagents defined in `.claude/agents/`.
- Every subagent MUST start any task by reading `docs/vision.md`,
  `docs/architecture.md`, `docs/phases.md`, `docs/conventions.md`, and
  `TASKS.md`.
- All coordination happens through artifacts: code, `TASKS.md`, and `docs/adr/`.
  Agents never assume state — they read it.

## Non-negotiable rules

1. **English only.** All code, file names, directory names, comments, commit
   messages, and documentation are written in English. No exceptions.
2. **Official documentation is the reference.** Every non-trivial technical
   decision must be grounded in the official documentation of the tool involved
   (Terraform, GKE, Argo CD, Vault, Strimzi, CloudNativePG, etc.). If the
   official docs do not support an approach, do not use it. When in doubt,
   fetch and cite the official docs — never guess.
3. **Simplicity over complexity.** Quality is not complexity. Prefer the
   simplest solution that meets the requirement. No speculative abstractions,
   no unused flexibility, no over-engineering. If a junior engineer cannot
   understand it in one reading, simplify it.
4. **GitOps only.** Nothing reaches the cluster via `kubectl apply` by hand.
   All workloads are declared in Git and reconciled by Argo CD.
5. **Conventional Commits**, in English, always.
6. **Cost discipline.** The environment is ephemeral and budget-guarded.
   No resource is created outside Terraform.

## Human gate (hard stop)

The following actions are NEVER executed by any agent. They are proposed,
documented, and left for the human operator to approve and run:

- `terraform apply` and `terraform destroy` against real GCP
- Merging into the branch watched by Argo CD
- Any action that creates billable cloud resources

Agents may freely run `terraform init`, `validate`, `plan`, `fmt`, tests,
linters, and anything local.

## Definition of done (per task)

A task is done only when: code passes validation/lint/tests, the change is
committed with a Conventional Commit, `TASKS.md` is updated, and any
architectural decision is captured as an ADR in `docs/adr/`.
