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

## Token discipline (FinOps for agents)

Token cost is to agent orchestration what cloud cost is to infrastructure.
The project must fit inside the operator's usage limits per session — a
phase that exhausts the limit mid-work is a failed phase plan.

1. **Lean board.** `TASKS.md` log entries are at most 10 lines. Details go
   to commits, PR descriptions, and ADRs. At phase close, the orchestrator
   archives the phase log to `docs/phase-logs/phase-<n>.md` and leaves a
   summary of at most 5 lines on the board.
2. **Batch delegations.** Every subagent invocation pays the fixed cost of
   reading the shared context. Delegate related tasks as one well-defined
   batch (e.g. "implement these three modules"), not as many small tasks.
3. **Review once per batch.** The reviewer is invoked once per completed
   batch, not per file or per task. A deep, source-verifying review happens
   only at the phase gate; task-level reviews are single-pass and focused
   (see the reviewer's own tiering rules).
4. **Prevent review rounds.** A failed review round is the most expensive
   event in this project: it reloads two full contexts. Owners MUST complete
   the pre-review self-check in `docs/conventions.md` before requesting
   review.
5. **Model policy.** Workers and reviewer run on Sonnet. Opus is not used
   unless the human operator explicitly asks for it on a specific decision.
6. **Orchestrator hygiene.** Delegate by pointing at file paths — never
   paste file contents into delegation prompts. Keep the orchestrator's own
   context small; compact between phases.
7. **Phase budget check.** Before starting a phase, the orchestrator
   estimates the number of delegations and states it in the plan. If a
   phase looks like it needs more than ~6-8 delegations, split the phase
   across sessions at a natural boundary instead of pushing through.

## Definition of done (per task)

A task is done only when: code passes validation/lint/tests, the change is
committed with a Conventional Commit, `TASKS.md` is updated, and any
architectural decision is captured as an ADR in `docs/adr/`.
