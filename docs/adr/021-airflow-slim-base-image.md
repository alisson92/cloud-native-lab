# ADR-021: Airflow image switches to the "slim" base + explicit providers

- Status: accepted
- Date: 2026-08-04
- Author: security-engineer

## Context

PR #38's `airflow-ci` `scan` job (Trivy, CRITICAL/HIGH gate) failed on
`apps/airflow/Dockerfile`'s previous `FROM apache/airflow:3.2.2` build.
Investigated in this session by pulling both the default and `slim` tags
and running `pip show`/`pip list` inside each
(https://airflow.apache.org/docs/docker-stack/index.html):

- The default (non-slim) `apache/airflow` image pre-installs ~30 community
  providers "often used by the users", including
  `apache-airflow-providers-google` and `-amazon`. `google-cloud-
  aiplatform`'s `full`/`testing`/`evaluation` extras (a dependency of the
  Google provider) transitively pull `litellm`/`ray` — packages with
  unrelated CRITICAL/HIGH CVEs (auth bypass, RCE via prompt templates/MCP,
  privilege escalation) that this project's Postgres+Kafka-only DAG
  (`docs/adr/020-airflow-kafka-postgres-source-split.md`) never imports.
  Confirmed via `docker run apache/airflow:3.2.2 python -m pip show
  litellm ray` (`Required-by: apache-airflow-providers-google` for `ray`;
  `litellm` traced to `google-cloud-aiplatform`'s extras via a `pip`
  metadata-requires scan) in this session.
- `apache-airflow:3.2.2` is already the newest 3.2.x patch (Docker Hub tag
  listing checked live: no `3.2.3` exists yet), so a patch bump could not
  have fixed this.
- The `slim` variant ships zero providers pre-installed (official docs:
  "contain only core Airflow... you need to add all the extras and
  providers that you need separately"), confirmed via `pip list` inside
  `apache/airflow:slim-3.2.2` (only `common-compat`/`common-io`/
  `common-sql`/`smtp`/`standard` — none of this project's needed
  Postgres/Kafka/FAB providers, and none of the flagged litellm/ray/
  tornado(flower) packages either).

Two providers this deployment actually needs are therefore not
pre-installed on `slim` and must be added explicitly:

- `apache-airflow-providers-postgres` — previously free on the default
  image; the DAG's Postgres reads and the shared-cluster metadata DB
  (`docs/adr/019-airflow-metadata-db-shared-cluster.md`) both need it.
- `apache-airflow-providers-fab` — NOT optional. The official Helm chart
  1.22.0's own `values.yaml` default sets `config.core.auth_manager` to
  `airflow.providers.fab.auth_manager.fab_auth_manager.FabAuthManager`
  (fetched live from the chart repo in this session), and
  `gitops/apps/airflow.yaml` does not override it. Confirmed `airflow
  users create` (used by the chart's `createUserJob`) is present only
  with FAB installed — absent from `airflow --help` on plain `slim`.

After switching base image + adding the two providers back, Trivy's
remaining findings (rescanned locally with `trivy image
--severity CRITICAL,HIGH --ignore-unfixed`) were:

1. `cryptography`, `python-multipart`, `starlette` (Python packages) —
   all genuinely part of Airflow's own FastAPI-based `apiServer` and its
   TLS/JWT stack, not dead weight. Checked each package's declared
   requirers (`apache-airflow-core -> cryptography>=44.0.3`/
   `starlette>=1.0.1`; `fastapi`/`starlette -> python-multipart>=0.0.18`)
   — all lower bounds only, no upper cap, so pinning newer fixed versions
   in the Dockerfile (`cryptography>=50.0.0`, `python-multipart>=0.0.30`,
   `starlette>=1.3.1`) resolved cleanly with no dependency conflict.
   Verified `airflow version` + `airflow providers list` still work after
   the bump.
2. `curl`/`libssl3` (Debian OS packages in the base Debian 12 layer) —
   genuinely on PATH/dynamically linked, not dead weight either. Fixed
   with the official "Adding new apt package" pattern from
   https://airflow.apache.org/docs/docker-stack/build.html
   (`USER root` -> `apt-get update && apt-get install --only-upgrade` ->
   `USER airflow`), confirmed the upgraded `dpkg -l` versions match the
   CVE's fixed version.
3. `quinn-proto` (GHSA-4w2j-m93h-cj5j, HIGH) inside 4 `uv`/`uvx`/`prek`
   rust binaries the base image bundles at `/home/airflow/.local/bin/` and
   `/home/airflow/.local/share/uv/tools/prek/bin/`. Confirmed the image's
   own `/entrypoint` script never calls `uv`/`uvx`/`prek` — they exist on
   `PATH` as build/dev conveniences only, never invoked by the running
   webserver/scheduler/dag-processor/api-server. Same class as
   `service-ci.yml`'s `node:22-alpine`/npm precedent
   (`docs/phase-logs/phase-5.md`): scoped out via `.github/workflows/
   airflow-ci.yml`'s `skip-files` (individual bundled binaries, not a
   directory-wide `skip-dirs`).
4. 3 Go stdlib CVEs (crypto/x509, os, mime) in `usr/bin/docker`, the
   Docker CLI binary the base image bundles (present on both the default
   and `slim` tags, confirmed in this session) — unrelated to
   `apache-airflow-providers-docker` (not installed here; its Python SDK
   talks to the Docker socket directly, not this CLI). Also confirmed
   absent from `/entrypoint`. Found only in the second CI run, not the
   first local scan: this session's local `trivy` CLI (v0.52.2) did not
   detect it even after a DB refresh, while the CI pipeline's pinned
   `aquasecurity/trivy-action@v0.36.0` (Trivy v0.70.0, per its own log)
   did — a reminder that local pre-flight scans with an older Trivy
   binary are not a substitute for the actual CI-pinned scanner version.
   Scoped out via the same `skip-files` mechanism as (3).

The Python-package and OS-package fixes (1-2) were verified locally
(`docker build apps/airflow` + `trivy image --exit-code 1`); the two
bundled-binary exclusions (3-4) were confirmed clean end-to-end only by
the actual `airflow-ci` `scan` job on PR #38 (CI's Trivy v0.70.0, matching
the version this gate actually runs).

## Decision

`apps/airflow/Dockerfile` switches its base from `apache/airflow:3.2.2` to
`apache/airflow:slim-3.2.2` (same Airflow version, same default Python
3.13), explicitly installs `apache-airflow-providers-postgres` and
`apache-airflow-providers-fab` alongside the existing Kafka provider,
upgrades `curl`/`libssl3` via `apt-get --only-upgrade` (official
"Extending the image" apt pattern), and pins `cryptography`/
`python-multipart`/`starlette` to CVE-fixed versions compatible with
Airflow's own unbounded lower-bound requirements.
`.github/workflows/airflow-ci.yml`'s `scan` job adds a `skip-files` list
for the 4 `uv`/`uvx`/`prek` binary paths whose only remaining finding is
unreachable at runtime.

## Consequences

**Easier:** the image's real attack surface (core Airflow + the 3
providers this deployment actually exercises) determines what the CI
gate checks — no google/amazon/celery/elasticsearch/grpc/hashicorp/
microsoft-azure/mysql/odbc/openlineage/redis/sendgrid/slack/smtp/
snowflake/ssh provider code (or their dependencies) ships in the image at
all, matching `docs/conventions.md`'s "delete code and config that is not
used" even more literally than the previous non-slim image did.

**Harder:** every provider this deployment needs must now be listed
explicitly in the Dockerfile — if a future DAG needs another provider
(e.g. `common-sql` for a new data source), it must be added here, unlike
the old default image where most providers were already present. This is
an intentional, documented trade-off: explicit is better than an
implicit ~30-provider surface most of which this lab never uses.

**Accepted trade-off:** the `curl`/`libssl3` OS-level upgrade is a
point-in-time fix — the next `apache/airflow` image rebuild will likely
already carry newer Debian security patches and make this `apt-get`
block a no-op (harmless either way, `--only-upgrade` is idempotent). No
attempt was made to pin `starlette`/`cryptography`/`python-multipart` via
a `constraints.txt` or lockfile — a single `pip install` version floor is
the simplest fix that satisfies `docs/conventions.md`'s "simplest thing
that works" for a lab-scale, low-churn image.
