#!/usr/bin/env bash
#
# bootstrap-vault.sh — idempotent Vault dev-mode bootstrap for this lab.
#
# WHY THIS EXISTS
# Vault runs in dev mode (docs/adr/006-vault-dev-mode-for-lab.md): all data
# is stored in-memory, so a `vault-0` pod restart wipes EVERYTHING —
# including the Kubernetes auth method itself (`vault auth enable
# kubernetes`), every policy/role, and every KV value
# (developer.hashicorp.com/vault/docs/concepts/dev-server: "All data is
# stored (encrypted) in-memory" and "will lose all data on every
# restart"). Before this script, 4 near-identical manual procedures lived
# in 4 READMEs; this script replaces all of them with one idempotent run.
# See docs/adr/010-vault-bootstrap-script.md for why a script was chosen
# over switching Vault to standalone mode.
#
# WHEN TO RUN
# - Once, after `vault` and `external-secrets` (gitops/apps/) report
#   Synced/Healthy on a fresh cluster.
# - Again, any time the `vault-0` pod restarts (check with
#   `kubectl -n vault get pod vault-0` — a low `RESTARTS` count changing,
#   or a new pod `AGE`, means it happened). Re-running is always safe:
#   every step below is written to be a no-op (or a harmless overwrite) on
#   an already-bootstrapped Vault.
#
# WHAT IT NEVER DOES
# - Never writes the root token to any file, this repo, or a Kubernetes
#   Secret. It is read from `vault-0`'s own startup log for this single
#   run and lives only in this script's process memory.
# - Never writes a real credential into this repo. Postgres/Redis
#   passwords are generated locally and cached OUTSIDE git (see
#   CACHE_DIR below, which is .gitignore'd) purely so that re-running
#   this script after a Vault restart writes back the SAME password an
#   already-running Postgres/Redis instance still expects — Vault losing
#   its copy of a password does not mean the workload using it forgets it
#   too.
#
# Docs consulted:
# - https://developer.hashicorp.com/vault/docs/concepts/dev-server
# - https://developer.hashicorp.com/vault/docs/auth/kubernetes
# - https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2
# - https://developer.hashicorp.com/vault/docs/commands/auth/list

set -euo pipefail

VAULT_NAMESPACE="vault"
VAULT_POD="vault-0"

# Local, gitignored cache for generated Postgres/Redis passwords, so reruns
# after a Vault restart are idempotent instead of rotating credentials that
# already-running workloads (Postgres/Redis, backed by their own PVCs, which
# do NOT lose state on a Vault restart) still expect. Never committed — see
# .gitignore.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${REPO_ROOT}/.vault-bootstrap-cache"

# trap ensures the root token never lingers in the environment after this
# script exits, even on error (CLAUDE.md script convention: set -euo
# pipefail + trap for cleanup).
cleanup() {
  unset VAULT_ROOT_TOKEN || true
}
trap cleanup EXIT

echo "==> Retrieving dev-mode root token from ${VAULT_POD}'s startup log..."
VAULT_ROOT_TOKEN="$(kubectl -n "${VAULT_NAMESPACE}" logs "${VAULT_POD}" 2>/dev/null \
  | grep -m1 'Root Token:' | awk '{print $NF}')"

if [[ -z "${VAULT_ROOT_TOKEN}" ]]; then
  echo "ERROR: could not find 'Root Token:' in '${VAULT_POD}' logs." >&2
  echo "Is the vault Argo CD Application Synced/Healthy? (kubectl -n ${VAULT_NAMESPACE} get pod ${VAULT_POD})" >&2
  exit 1
fi

# Runs a `vault` CLI subcommand inside vault-0, authenticated via the root
# token passed as an env var for this single invocation only (no `vault
# login`, so no token is ever persisted to the pod's local token helper
# file either). `-i` keeps stdin open so heredocs (policy bodies) can be
# piped in.
vault_exec() {
  kubectl -n "${VAULT_NAMESPACE}" exec -i "${VAULT_POD}" -- \
    env VAULT_TOKEN="${VAULT_ROOT_TOKEN}" vault "$@"
}

# Returns a cached password for $1 if one exists, else generates a new one
# and caches it. 32 random bytes, base64-encoded
# (developer.hashicorp.com/vault/docs/concepts/dev-server documents no
# password-generation opinion; openssl rand is this repo's existing
# convention-free choice for local secret generation, not persisted to
# Vault's own storage since dev-mode can't persist it either).
get_or_generate_password() {
  local name="$1"
  local cache_file="${CACHE_DIR}/${name}"
  if [[ -f "${cache_file}" ]]; then
    cat "${cache_file}"
    return
  fi
  mkdir -p "${CACHE_DIR}"
  chmod 700 "${CACHE_DIR}"
  local generated
  generated="$(openssl rand -base64 32)"
  printf '%s' "${generated}" >"${cache_file}"
  chmod 600 "${cache_file}"
  printf '%s' "${generated}"
}

echo "==> Ensuring the Kubernetes auth method is enabled..."
# Idempotent: only enable if not already mounted. Enabling an already-
# enabled auth method errors, so check first rather than swallow the error
# blindly (developer.hashicorp.com/vault/docs/commands/auth/list).
if ! vault_exec auth list -format=json | grep -q '"kubernetes/"'; then
  vault_exec auth enable kubernetes
else
  echo "    kubernetes auth method already enabled, skipping."
fi

echo "==> Configuring the Kubernetes auth method (idempotent: always overwrites with the same value)..."
vault_exec write auth/kubernetes/config \
  kubernetes_host="https://kubernetes.default.svc:443"

# ---------------------------------------------------------------------------
# secrets-demo (Phase 3 exit-gate demo): gitops/secrets-demo/README.md
# ---------------------------------------------------------------------------
echo "==> secrets-demo: writing test KV secret..."
vault_exec kv put secret/test-secret key=test-value-not-real

echo "==> secrets-demo: writing eso-read policy..."
vault_exec policy write eso-read - <<'EOF'
path "secret/data/test-secret" {
  capabilities = ["read"]
}
EOF

echo "==> secrets-demo: writing eso role..."
vault_exec write auth/kubernetes/role/eso \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=secrets-demo \
  audience=vault \
  policies=eso-read \
  ttl=1h

# ---------------------------------------------------------------------------
# postgres (Phase 4): gitops/data/postgres/README.md
# ---------------------------------------------------------------------------
echo "==> postgres: writing KV credentials (cached password, stable across reruns)..."
POSTGRES_PASSWORD="$(get_or_generate_password postgres)"
vault_exec kv put secret/postgres \
  username=orders \
  password="${POSTGRES_PASSWORD}"

echo "==> postgres: writing postgres-read policy..."
vault_exec policy write postgres-read - <<'EOF'
path "secret/data/postgres" {
  capabilities = ["read"]
}
EOF

echo "==> postgres: writing postgres role..."
vault_exec write auth/kubernetes/role/postgres \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=postgres \
  audience=vault \
  policies=postgres-read \
  ttl=1h

# ---------------------------------------------------------------------------
# redis (Phase 4): gitops/data/redis/README.md
# ---------------------------------------------------------------------------
echo "==> redis: writing KV credentials (cached password, stable across reruns)..."
REDIS_PASSWORD="$(get_or_generate_password redis)"
vault_exec kv put secret/redis \
  password="${REDIS_PASSWORD}"

echo "==> redis: writing redis-read policy..."
vault_exec policy write redis-read - <<'EOF'
path "secret/data/redis" {
  capabilities = ["read"]
}
EOF

echo "==> redis: writing redis role..."
vault_exec write auth/kubernetes/role/redis \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=redis \
  audience=vault \
  policies=redis-read \
  ttl=1h

# ---------------------------------------------------------------------------
# rabbitmq (Phase 6): gitops/data/rabbitmq/README.md
# ---------------------------------------------------------------------------
echo "==> rabbitmq: writing KV credentials (cached password, stable across reruns)..."
RABBITMQ_PASSWORD="$(get_or_generate_password rabbitmq)"
vault_exec kv put secret/rabbitmq \
  username=app \
  password="${RABBITMQ_PASSWORD}"

echo "==> rabbitmq: writing rabbitmq-read policy..."
vault_exec policy write rabbitmq-read - <<'EOF'
path "secret/data/rabbitmq" {
  capabilities = ["read"]
}
EOF

echo "==> rabbitmq: writing rabbitmq role..."
vault_exec write auth/kubernetes/role/rabbitmq \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=rabbitmq \
  audience=vault \
  policies=rabbitmq-read \
  ttl=1h

# ---------------------------------------------------------------------------
# kafka (Phase 6 batch 2): gitops/data/kafka/README.md
# username="backend" MUST match gitops/data/kafka/user.yaml's KafkaUser
# metadata.name — a KafkaUser's SASL username is always its own resource
# name, so this is documentation-only here (same pattern as postgres's
# owner match above), never read back by Strimzi itself.
# ---------------------------------------------------------------------------
echo "==> kafka: writing KV credentials (cached password, stable across reruns)..."
KAFKA_PASSWORD="$(get_or_generate_password kafka)"
vault_exec kv put secret/kafka \
  username=backend \
  password="${KAFKA_PASSWORD}"

echo "==> kafka: writing kafka-read policy..."
vault_exec policy write kafka-read - <<'EOF'
path "secret/data/kafka" {
  capabilities = ["read"]
}
EOF

echo "==> kafka: writing kafka role..."
vault_exec write auth/kubernetes/role/kafka \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=kafka \
  audience=vault \
  policies=kafka-read \
  ttl=1h

# ---------------------------------------------------------------------------
# backend (Phase 5, extended Phase 6): gitops/services/backend/README.md
# Reuses the same secret/postgres + secret/redis + secret/rabbitmq +
# secret/kafka KV data written above; only adds a policy/role scoped to the
# `apps` namespace's `vault-auth` SA.
# ---------------------------------------------------------------------------
echo "==> backend: writing backend-read policy..."
vault_exec policy write backend-read - <<'EOF'
path "secret/data/postgres" {
  capabilities = ["read"]
}
path "secret/data/redis" {
  capabilities = ["read"]
}
path "secret/data/rabbitmq" {
  capabilities = ["read"]
}
path "secret/data/kafka" {
  capabilities = ["read"]
}
EOF

echo "==> backend: writing backend role..."
vault_exec write auth/kubernetes/role/backend \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=apps \
  audience=vault \
  policies=backend-read \
  ttl=1h

# ---------------------------------------------------------------------------
# worker (Phase 6): gitops/services/worker/README.md
# Least-privilege: worker only ever needs secret/rabbitmq (it consumes
# order-created messages, it never touches Postgres/Redis directly). Bound
# to its OWN ServiceAccount name "worker-vault-auth" (not backend's
# "vault-auth"), even though both share the "apps" namespace — Vault's
# Kubernetes auth binds a role to a (SA name, SA namespace) pair
# (developer.hashicorp.com/vault/docs/auth/kubernetes), so reusing the same
# SA name for both roles would let anything holding that one SA's token log
# in as EITHER role, defeating the whole point of a narrower worker policy.
# ---------------------------------------------------------------------------
echo "==> worker: writing worker-read policy..."
vault_exec policy write worker-read - <<'EOF'
path "secret/data/rabbitmq" {
  capabilities = ["read"]
}
EOF

echo "==> worker: writing worker role..."
vault_exec write auth/kubernetes/role/worker \
  bound_service_account_names=worker-vault-auth \
  bound_service_account_namespaces=apps \
  audience=vault \
  policies=worker-read \
  ttl=1h

echo "==> Done. Verify with each directory's 'Verifying the exit gate' section."
