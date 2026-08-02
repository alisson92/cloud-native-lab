# Runbook — Test the order flow through the browser (end-user view)

**Last updated:** 2026-08-02
**Author:** orchestrator (cloud-native-lab)
**Environment:** Kind Dev
**Estimated time:** 5 minutes
**Risk level:** Low

---

## Objective

This runbook describes how to reach the application's storefront (Phase 5,
`docs/phases.md`) through a browser, the way an end user would, and run the
full flow: browse the catalog, place an order, and see the confirmation.
Use it whenever you need to manually validate that the
`frontend -> BFF -> backend -> PostgreSQL/Redis` path is working end-to-end
on the Kind cluster.

---

## Prerequisites

- [ ] Pointed at the right cluster: `kubectl config current-context` returns
      `kind-cloud-native-lab`
- [ ] `root-app` is synced and healthy:
      `kubectl -n argocd get application root-app` shows `Synced`/`Healthy`
- [ ] All 4 application pods are `1/1 Running`:
      `kubectl -n apps get pod` lists `backend`, `bff`, `frontend`, and
      `worker`
- [ ] The manual Vault bootstrap for the backend has run at least once
      since the last restart of the `vault-0` pod
      (`gitops/services/backend/README.md`) — without it, the backend
      cannot read its Postgres/Redis credentials
- [ ] No other `kubectl port-forward` session is already using local port
      `8082`

---

## ⚠️ Points of attention

- **Vault dev-mode loses all state on every pod restart**
  (`docs/adr/006-vault-dev-mode-for-lab.md`). If `vault-0` restarted since
  the bootstrap was last run, the `ExternalSecret` objects for `backend`,
  `postgres`, and `redis` will silently stop syncing
  (`SecretSyncedError`), and the backend will be left without valid
  credentials. This already happened once during Phase 5 and went
  unnoticed for ~14h — always check the Vault bootstrap prerequisite
  before assuming "this shouldn't be broken."
- **`port-forward` runs in the foreground** — it blocks the terminal while
  active. Run it in the background (`&`) or in a separate tab, and
  remember to stop it at the end (cleanup step).
- This runbook does not change any cluster state beyond creating a test
  order in Postgres — safe to repeat as many times as needed.

---

## Steps

### 1. Confirm the environment is healthy

```bash
# Confirms Argo CD successfully synced the Phase 5 manifests
kubectl -n argocd get application root-app
```

**Expected result:**
```
NAME       SYNC STATUS   HEALTH STATUS
root-app   Synced        Healthy
```

```bash
# Confirms all 4 application services are up
kubectl -n apps get pod
```

**Expected result:**
```
NAME                          READY   STATUS    RESTARTS   AGE
backend-xxxxxxxxxx-xxxxx      1/1     Running   0          <age>
bff-xxxxxxxxxx-xxxxx          1/1     Running   0          <age>
frontend-xxxxxxxxxx-xxxxx     1/1     Running   0          <age>
worker-xxxxxxxxxx-xxxxx       1/1     Running   0          <age>
```

If any pod isn't `1/1 Running`, stop here and check the
**Troubleshooting** section before continuing.

---

### 2. Confirm the backend's credentials are synced

```bash
# The ExternalSecret must be SecretSynced for the backend to reach
# Postgres and Redis
kubectl -n apps get externalsecret backend-credentials
```

**Expected result:**
```
NAME                  STORETYPE     STORE           STATUS         READY
backend-credentials   SecretStore   vault-backend   SecretSynced   True
```

> ⚠️ **Attention:** if this shows `SecretSyncedError`, Vault likely
> restarted and lost its bootstrap. See **Troubleshooting** — there's no
> point continuing to the browser, the backend will return a 500 on any
> call that touches Postgres/Redis.

---

### 3. Open a port-forward tunnel to the frontend

```bash
# Exposes the "frontend" Service (port 8082, ClusterIP) on your machine.
# This command runs in the foreground — use & to run it in the
# background, or open another terminal for the next step.
kubectl -n apps port-forward svc/frontend 8082:8082
```

**Expected result:**
```
Forwarding from 127.0.0.1:8082 -> 8082
Forwarding from [::1]:8082 -> 8082
```

Keep this terminal open (or run with `&` at the end of the command) while
using the browser.

---

### 4. Open the application in the browser

Go to:

```
http://localhost:8082
```

**Expected result:** the storefront page loads and shows the catalog's
product list (e.g. "Coffee Mug", "Notebook", "Sticker Pack"), each with an
order button.

> If the page loads but the product list is empty or the page hangs, see
> **Troubleshooting** — this usually means the backend couldn't reach
> Postgres/Redis (go back to step 2).

---

### 5. Place an order

1. Pick a product from the list.
2. Click the order button next to the item.
3. Wait for the confirmation to appear on screen.

**Expected result:** the page shows a confirmation with the order id
(`orderId`) and the calculated total — the price is always looked up
server-side, never trusted from the browser.

---

### 6. Post-procedure validation

Confirm behind the scenes that the order actually persisted and that the
catalog went through Redis's cache (not required for a manual test, but
closes the loop if you want a technical confirmation):

```bash
# Confirms the order was written to Postgres. The password must be
# resolved by *your* shell, not the pod's — the postgres container has no
# kubectl binary, so nesting `kubectl get secret` inside `sh -c '...'`
# (single-quoted) fails with "kubectl: not found" and silently falls back
# to psql's interactive password prompt instead.
PG_PASSWORD=$(kubectl -n postgres get secret postgres-app-credentials -o jsonpath='{.data.password}' | base64 -d)
kubectl -n postgres exec -i postgres-1 -- \
  sh -c "PGPASSWORD='$PG_PASSWORD' psql -h 127.0.0.1 -U orders -d orders -c 'SELECT * FROM orders ORDER BY id DESC LIMIT 1;'"
```

> ⏱️ **Timing matters here:** the backend caches the catalog in Redis with
> a 60-second TTL (`apps/backend/src/catalog.js`, `CACHE_TTL_SECONDS`). If
> more than 60s passed since your last catalog request (step 4's page
> load, or step 5's order confirmation, which re-fetches it), the key
> will have expired and `GET` returns nothing — that's the cache working
> as designed, not a failure. Reload the storefront page (or `curl -s
> http://localhost:8082/api/catalog > /dev/null`) right before running
> this command to guarantee a hit.

```bash
# Confirms the catalog is cached in Redis (real cache-aside, not a
# pass-through)
kubectl -n redis exec deploy/redis -- redis-cli \
  -a "$(kubectl -n redis get secret redis-credentials -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)" \
  GET catalog:items
```

> The `Warning: Using a password with '-a' ... may not be safe` line is
> `redis-cli`'s own generic advisory about passing a password as a CLI
> argument (visible to anyone who can list processes on that node) — it
> is expected here and not a failure. It's shown, not silenced, precisely
> so nobody normalizes passing real production credentials this way.

**Success criteria:**
- [ ] The storefront page loaded the catalog in the browser
- [ ] The order was confirmed on screen with an `orderId` and total
- [ ] The Postgres `SELECT` returns the row for the order just created
- [ ] The Redis `GET catalog:items` returns the catalog JSON (not empty)

---

### 7. Cleanup

```bash
# Stop the port-forward (Ctrl+C if running in the foreground, or:)
kill %1   # if you ran port-forward with `&` in this same shell session
```

---

## Rollback

Not applicable — this runbook is read-only/verification with respect to
the infrastructure (it doesn't modify manifests or configuration). The
only side effect is test rows created in Postgres's `orders` table, which
don't need to be reverted (lab data, ephemeral environment by design —
`docs/adr/004-local-first-validation-with-kind.md`).

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `kubectl -n apps get pod` shows a pod not `Running`/`Ready` | Image not found (`ImagePullBackOff`) or `CrashLoopBackOff` from a Postgres/Redis connection failure at startup | `kubectl -n apps describe pod <pod>` and `kubectl -n apps logs <pod>`. If `ImagePullBackOff`, confirm the GHCR packages are public (`docker pull ghcr.io/alisson92/<service>:<tag>` without logging in). Consider the `k8s-debug` skill for a guided investigation. |
| `backend-credentials` shows `SecretSyncedError` | Vault dev-mode restarted and lost its bootstrap (`ADR-006`) | Re-run the manual bootstrap in `gitops/services/backend/README.md` (and, if needed, `gitops/data/postgres/README.md` and `gitops/data/redis/README.md` too — a Vault restart drops **every** role at once, not just the backend's). |
| Browser page loads but the catalog is empty or shows a generic error | Backend couldn't read its credentials or can't reach Postgres/Redis | Test directly: `kubectl -n apps exec deploy/backend -- wget -qO- http://localhost:8080/health`. If that fails, check step 2 (ExternalSecret) before anything else. |
| `kubectl port-forward` refuses the connection or drops on its own | Port 8082 already in use locally, or the frontend pod restarted mid-tunnel | Check for another active `port-forward` (`lsof -i :8082` or similar) and stop it; redo step 3. |
| `root-app` stuck `OutOfSync`/`Degraded` | Some resource elsewhere in the `gitops/` tree (not necessarily Phase 5) is blocking the sync wave — Argo CD applies the whole tree as one operation | Check controller logs: `kubectl -n argocd logs -l app.kubernetes.io/name=argocd-application-controller --tail=100`. Look for a `SecretStore`/`ExternalSecret` error in any namespace, not just `apps`. |
| `redis-cli GET catalog:items` returns nothing (empty reply, no error) | The cache key's 60s TTL expired since the last catalog request — this is expected cache-aside behavior, not a bug | Re-trigger a catalog fetch (reload the storefront page, or `curl -s http://localhost:8082/api/catalog`) and immediately re-run the `GET`. `TTL catalog:items` returning `-2` confirms the key doesn't currently exist. |

---

## References

- `docs/phases.md` — Phase 5 exit gate definition
- `docs/vision.md` — role of each component in the scenario (frontend, BFF, backend, Postgres, Redis)
- `gitops/services/README.md` — Phase 5 manifest layout
- `gitops/services/backend/README.md` — Vault bootstrap for the backend
- `docs/adr/006-vault-dev-mode-for-lab.md` — why Vault loses state on every restart
- `docs/phase-logs/phase-5.md` — full Phase 5 log, including the live-only bugs found while validating this runbook
