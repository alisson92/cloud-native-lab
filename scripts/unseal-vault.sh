#!/usr/bin/env bash
#
# unseal-vault.sh — post-restart unseal helper for this lab's standalone,
# file-storage-backed Vault (docs/adr/022-vault-standalone-file-storage.md).
#
# WHY THIS EXISTS
# Standalone mode with the `file` storage backend uses the default Shamir
# seal (developer.hashicorp.com/vault/docs/concepts/seal): "Every
# initialized Vault server starts in the sealed state" after EVERY process
# restart, and stays sealed — refusing all requests — until enough unseal
# key shares (this lab's threshold: 3 of 5, set by
# scripts/bootstrap-vault.sh's one-time `vault operator init`) are supplied
# via `vault operator unseal`. This is the accepted trade-off for
# persistence without an auto-unseal/KMS mechanism (out of scope for this
# lab) -- see docs/adr/022 for the full reasoning.
#
# WHEN TO RUN
# Any time `vault-0` restarts (check with `kubectl -n vault get pod
# vault-0` -- a `RESTARTS` count change or new pod `AGE` means it
# happened). Idempotent: does nothing if Vault is already unsealed.
#
# WHAT IT NEVER DOES
# - Never needs the root token (unsealing is a storage-decryption
#   operation, not an authenticated Vault API call).
# - Never writes the unseal keys anywhere new -- it only reads the cache
#   scripts/bootstrap-vault.sh already wrote
#   (.vault-bootstrap-cache/vault-init.json, gitignored, never committed).
#
# Docs consulted:
# - https://developer.hashicorp.com/vault/docs/concepts/seal
# - https://developer.hashicorp.com/vault/docs/commands/operator/unseal
# - https://developer.hashicorp.com/vault/docs/commands/status

set -euo pipefail

VAULT_NAMESPACE="vault"
VAULT_POD="vault-0"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${REPO_ROOT}/.vault-bootstrap-cache"
INIT_FILE="${CACHE_DIR}/vault-init.json"

if [[ ! -f "${INIT_FILE}" ]]; then
  echo "ERROR: ${INIT_FILE} not found." >&2
  echo "Run scripts/bootstrap-vault.sh first (it performs the one-time" >&2
  echo "'vault operator init' and caches the unseal keys here)." >&2
  exit 1
fi

status_json="$(kubectl -n "${VAULT_NAMESPACE}" exec "${VAULT_POD}" -- \
  vault status -format=json)"
sealed="$(echo "${status_json}" | jq -r '.sealed')"

if [[ "${sealed}" != "true" ]]; then
  echo "==> Vault is already unsealed. Nothing to do."
  exit 0
fi

threshold="$(jq -r '.unseal_threshold' "${INIT_FILE}")"
echo "==> Vault is sealed. Applying ${threshold} unseal key share(s)..."

# `vault operator unseal <KEY>` takes the key as a positional argument.
# HashiCorp's own docs note this is discouraged when a human types the key
# interactively (it would land in shell history) -- here the key is read
# from a local, gitignored file by this script, never typed or echoed, so
# that specific concern does not apply; passed as an argument because
# `vault operator unseal` has no documented stdin/env-var input mode.
mapfile -t unseal_keys < <(jq -r ".unseal_keys_b64[0:${threshold}][]" "${INIT_FILE}")
for key in "${unseal_keys[@]}"; do
  kubectl -n "${VAULT_NAMESPACE}" exec "${VAULT_POD}" -- \
    vault operator unseal "${key}" >/dev/null
done

final_sealed="$(kubectl -n "${VAULT_NAMESPACE}" exec "${VAULT_POD}" -- \
  vault status -format=json | jq -r '.sealed')"

if [[ "${final_sealed}" == "true" ]]; then
  echo "ERROR: Vault is still sealed after applying ${threshold} key shares." >&2
  exit 1
fi

echo "==> Vault unsealed."
