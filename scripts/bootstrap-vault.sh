#!/usr/bin/env bash
#
# bootstrap-vault.sh — ONE-TIME Vault init + Kubernetes-auth/KV setup for
# this lab (standalone mode, file storage backend).
#
# WHY THIS EXISTS
# Vault now runs in standalone mode with the `file` storage backend on a
# local PVC (docs/adr/022-vault-standalone-file-storage.md, superseding
# ADR-006's dev-mode storage decision only). Unlike dev mode, this PERSISTS
# the Kubernetes auth method, every policy/role, and every KV value across
# `vault-0` pod restarts — so this script only needs to run once per fresh
# Vault storage lifetime (once per PVC), not after every restart.
#
# After a restart, Vault starts SEALED (developer.hashicorp.com/vault/docs/
# concepts/seal) but keeps everything this script wrote. Run
# scripts/unseal-vault.sh instead — do NOT re-run this script on a restart,
# it is intentionally NOT what fixes a sealed Vault.
#
# Before this script existed, this ritual was duplicated across READMEs
# (docs/adr/010-vault-bootstrap-script.md); this script still writes all of
# it in one run, safe to re-run if a future phase adds a new consumer (the
# role/policy/KV section below stays idempotent).
#
# WHEN TO RUN
# - Once, after `vault` and `external-secrets` (gitops/apps/) report
#   Synced/Healthy on a fresh cluster (fresh PVC = uninitialized Vault).
# - Again ONLY if a future phase adds a new Kubernetes-auth role/policy/KV
#   path — re-running is safe (idempotent) and will skip straight past the
#   already-completed init/unseal steps.
# - NOT after every `vault-0` restart — use scripts/unseal-vault.sh for
#   that (this script errors out if Vault is sealed, to avoid confusing the
#   two operations).
#
# WHAT IT NEVER DOES
# - Never writes the root token or unseal keys into this repo or a
#   Kubernetes Secret. `vault operator init`'s output is cached ONLY in
#   the local, .gitignore'd CACHE_DIR below (see
#   docs/adr/022-vault-standalone-file-storage.md's "custody question"
#   section for why this is judged acceptable at this lab's scale, and what
#   is lost if that cache is lost: the Vault PVC becomes unrecoverable, but
#   nothing else in this GitOps-managed lab depends on it surviving).
# - Never writes a real credential into this repo. Postgres/Redis/RabbitMQ/
#   Kafka/Airflow passwords are generated locally and cached OUTSIDE git
#   (see CACHE_DIR below) purely so re-running this script (e.g. to add a
#   new consumer) writes back the SAME password an already-running
#   workload still expects.
#
# Docs consulted:
# - https://developer.hashicorp.com/vault/docs/concepts/seal
#   (vault operator init/unseal flow, Shamir default 5 shares / 3 threshold)
# - https://developer.hashicorp.com/vault/docs/commands/operator/init
#   (-format=json output fields: unseal_keys_b64, root_token)
# - https://developer.hashicorp.com/vault/docs/commands/status
#   (-format=json fields: initialized, sealed; exit code 2 = sealed)
# - https://developer.hashicorp.com/vault/docs/auth/kubernetes
# - https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2
# - https://developer.hashicorp.com/vault/docs/commands/auth/list

set -euo pipefail

VAULT_NAMESPACE="vault"
VAULT_POD="vault-0"

# Local, gitignored cache for the one-time `vault operator init` output
# (unseal keys + root token — NEW, see docs/adr/022) and for generated
# Postgres/Redis/RabbitMQ/Kafka/Airflow passwords (unchanged from
# docs/adr/010), so reruns are idempotent instead of rotating credentials
# that already-running workloads (backed by their own PVCs, unaffected by a
# Vault restart) still expect. Never committed — see .gitignore.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${REPO_ROOT}/.vault-bootstrap-cache"
INIT_FILE="${CACHE_DIR}/vault-init.json"

# trap ensures the root token never lingers in the environment after this
# script exits, even on error (CLAUDE.md script convention: set -euo
# pipefail + trap for cleanup).
cleanup() {
  unset VAULT_ROOT_TOKEN || true
}
trap cleanup EXIT

# `vault status` exits non-zero when sealed (2) even though it still prints
# valid JSON (developer.hashicorp.com/vault/docs/commands/status: 0 =
# unsealed, 1 = error, 2 = sealed) -- `|| true` keeps `set -e` from aborting
# on the expected sealed/uninitialized exit codes; `.initialized` is read
# from the JSON body either way.
mkdir -p "${CACHE_DIR}"
chmod 700 "${CACHE_DIR}"

status_json="$(kubectl -n "${VAULT_NAMESPACE}" exec "${VAULT_POD}" -- \
  vault status -format=json || true)"
initialized="$(echo "${status_json}" | jq -r '.initialized')"

if [[ "${initialized}" != "true" ]]; then
  echo "==> Vault is uninitialized. Running 'vault operator init' (one time only)..."
  # Default 5 key shares / 3 threshold (developer.hashicorp.com/vault/docs/
  # concepts/seal) — this lab does not need a custom split, single operator.
  init_json="$(kubectl -n "${VAULT_NAMESPACE}" exec -i "${VAULT_POD}" -- \
    vault operator init -key-shares=5 -key-threshold=3 -format=json)"
  printf '%s' "${init_json}" >"${INIT_FILE}"
  chmod 600 "${INIT_FILE}"
  echo "    Unseal keys + root token cached in ${INIT_FILE} (gitignored, never committed)."
elif [[ ! -f "${INIT_FILE}" ]]; then
  echo "ERROR: Vault reports initialized=true but ${INIT_FILE} is missing." >&2
  echo "This means the unseal keys/root token from a prior 'vault operator init' were lost." >&2
  echo "Without them Vault's existing PVC cannot be unsealed again -- see the 'custody question'" >&2
  echo "in docs/adr/022-vault-standalone-file-storage.md. Recovery requires deleting the PVC and" >&2
  echo "re-initializing (all existing Vault data is lost either way at that point)." >&2
  exit 1
else
  echo "==> Vault already initialized; reusing cached ${INIT_FILE}."
fi

echo "==> Ensuring Vault is unsealed for this run..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/unseal-vault.sh"

VAULT_ROOT_TOKEN="$(jq -r '.root_token' "${INIT_FILE}")"
if [[ -z "${VAULT_ROOT_TOKEN}" || "${VAULT_ROOT_TOKEN}" == "null" ]]; then
  echo "ERROR: could not read root_token from ${INIT_FILE}." >&2
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
# and caches it. 32 random bytes, base64-encoded (no official Vault doc
# opinion on password generation; openssl rand is this repo's existing
# convention-free choice for local secret generation). Cached locally
# rather than read back from Vault itself so a full Kind-cluster recreation
# (fresh Vault PVC AND fresh Postgres/Redis/etc. PVCs at the same time)
# still reuses the same value a human might already have noted down.
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

echo "==> Ensuring the KV v2 secrets engine is enabled at secret/..."
# Dev mode auto-mounts a v2 KV engine at "secret/" on startup
# (developer.hashicorp.com/vault/docs/concepts/dev-server); standalone mode
# starts with no secrets engines beyond Vault's built-in ones, so this must
# be enabled explicitly the first time (developer.hashicorp.com/vault/docs/
# secrets/kv/kv-v2, "Setup" section: `vault secrets enable -path=secret
# kv-v2`). Idempotent for the same reason as the auth method above:
# enabling an already-enabled mount errors, so check first.
if ! vault_exec secrets list -format=json | grep -q '"secret/"'; then
  vault_exec secrets enable -path=secret kv-v2
else
  echo "    secret/ KV v2 engine already enabled, skipping."
fi

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
# Extended in Phase 7 with "secret/data/airflow": the "airflow" Postgres
# managed role (gitops/data/postgres/cluster.yaml's spec.managed.roles)
# needs its password Secret created IN the postgres namespace (CloudNativePG
# requires passwordSecret to be colocated with the Cluster CR), so this
# namespace's own SecretStore role ("postgres") is the one that must read
# that Vault path — see
# gitops/data/postgres/airflow-role-externalsecret.yaml.
vault_exec policy write postgres-read - <<'EOF'
path "secret/data/postgres" {
  capabilities = ["read"]
}
path "secret/data/airflow" {
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
# Extended in Phase 7 with "secret/data/airflow-kafka": the "airflow"
# KafkaUser's password Secret must live in the kafka namespace (Strimzi
# requires this, same colocation rule as backend's own credentials), so
# this namespace's SecretStore role ("kafka") is the one that must read
# that path too — see
# gitops/data/kafka/airflow-user-externalsecret.yaml.
vault_exec policy write kafka-read - <<'EOF'
path "secret/data/kafka" {
  capabilities = ["read"]
}
path "secret/data/airflow-kafka" {
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

# ---------------------------------------------------------------------------
# airflow (Phase 7): gitops/data/airflow/README.md
# Two credentials: the metadata-database role ("secret/airflow", also read
# by postgres/'s own SecretStore for the managed-role passwordSecret, see
# the "postgres" block above) and the Kafka user ("secret/airflow-kafka",
# also read by kafka/'s own SecretStore, see the "kafka" block above).
# username="airflow" MUST match both cluster.yaml's spec.managed.roles[].name
# and airflow-user.yaml's KafkaUser metadata.name.
# ---------------------------------------------------------------------------
echo "==> airflow: writing metadata-db KV credentials (cached password, stable across reruns)..."
AIRFLOW_DB_PASSWORD="$(get_or_generate_password airflow)"
vault_exec kv put secret/airflow \
  username=airflow \
  password="${AIRFLOW_DB_PASSWORD}"

echo "==> airflow: writing Kafka KV credentials (cached password, stable across reruns)..."
AIRFLOW_KAFKA_PASSWORD="$(get_or_generate_password airflow-kafka)"
vault_exec kv put secret/airflow-kafka \
  username=airflow \
  password="${AIRFLOW_KAFKA_PASSWORD}"

echo "==> airflow: writing airflow-read policy..."
# Also reads secret/data/postgres: the sales-report DAG reuses the
# existing "orders" application credential to query orders/products
# (docs/adr/020-airflow-kafka-postgres-source-split.md) rather than a new
# read-only Postgres role.
vault_exec policy write airflow-read - <<'EOF'
path "secret/data/airflow" {
  capabilities = ["read"]
}
path "secret/data/airflow-kafka" {
  capabilities = ["read"]
}
path "secret/data/postgres" {
  capabilities = ["read"]
}
EOF

echo "==> airflow: writing airflow role..."
vault_exec write auth/kubernetes/role/airflow \
  bound_service_account_names=vault-auth \
  bound_service_account_namespaces=airflow \
  audience=vault \
  policies=airflow-read \
  ttl=1h

echo "==> Done. Verify with each directory's 'Verifying the exit gate' section."
