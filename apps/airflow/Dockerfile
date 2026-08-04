# Airflow (Phase 7, docs/phases.md): extends the official image, adding
# only the provider packages it does not ship by default, plus a scoped
# security fix-up — see docs/adr/021-airflow-slim-base-image.md for the
# full CVE investigation (PR #38 CI failure) behind this file's shape.
#
# Base tag: "slim-3.2.2" (Python 3.13 default, confirmed via `docker run
# apache/airflow:slim-3.2.2 python --version` in this session), NOT the
# default (non-slim) "3.2.2" tag used previously. The default image
# pre-installs ~30 providers (confirmed via `pip list` inside both tags in
# this session) including apache-airflow-providers-google and -amazon,
# whose optional ML/LLM extras (google-cloud-aiplatform's "full" extra,
# litellm-proxy) pulled in `litellm`/`ray` — packages with unrelated
# CRITICAL/HIGH CVEs (auth bypass, RCE) that Trivy correctly flagged, and
# that this project's Postgres+Kafka-only DAG never imports or executes
# (docs/adr/020-airflow-kafka-postgres-source-split.md). The slim image
# ships zero providers pre-installed
# (https://airflow.apache.org/docs/docker-stack/index.html: "slim image...
# contain only core Airflow"), so this Dockerfile now installs every
# provider this deployment actually uses, explicitly:
#   - apache-airflow-providers-postgres: previously relied on the default
#     image's pre-install (see prior version of this comment); the DAG's
#     Postgres reads + gitops/apps/airflow.yaml's shared-cluster metadata
#     DB (docs/adr/019) both need it.
#   - apache-airflow-providers-fab: NOT optional — chart 1.22.0's own
#     values.yaml default (`config.core.auth_manager`) sets
#     `airflow.providers.fab.auth_manager.fab_auth_manager.FabAuthManager`
#     (confirmed by fetching the chart's values.yaml in this session),
#     and gitops/apps/airflow.yaml does not override it, so the FAB
#     provider backs both `apiServer` auth and the chart's `createUserJob`
#     (`airflow users create`, a FAB-provider-only CLI command — confirmed
#     absent from `airflow --help` on the slim image before adding it
#     back).
#   - apache-airflow-providers-apache-kafka: unchanged from before, see
#     below.
#
# Base tag MUST match gitops/apps/airflow.yaml's
# `airflowVersion`/`images.airflow.tag` (both left at the official Helm
# chart's own default for chart version 1.22.0, confirmed live against
# https://airflow.apache.org/index.yaml in this session) — the chart uses
# `airflowVersion` to decide DAG-processor/scheduler behavior that only
# makes sense if it matches the image actually running. "slim-3.2.2" is
# still Airflow 3.2.2, only the packaging differs, so this alignment holds.
#
# Pattern follows the official "Extending the image" guide (not
# "Customizing", which is for packages needing compiled build tools):
# https://airflow.apache.org/docs/docker-stack/build.html
# — pinning `apache-airflow==${AIRFLOW_VERSION}` alongside the new packages
# is the guide's own recommendation, to fail loudly instead of silently
# upgrading/downgrading Airflow itself if a dependency conflicts. The three
# `pip install` version floors below (cryptography/python-multipart/
# starlette) close out the remaining CVEs Trivy found in packages that ARE
# part of this image's real attack surface (Airflow's own FastAPI-based
# apiServer and its TLS/JWT dependencies) — confirmed compatible by
# checking each package's declared requirers in this session
# (`apache-airflow-core -> cryptography>=44.0.3`/`starlette>=1.0.1`;
# `fastapi`/`starlette` -> `python-multipart>=0.0.18`: all lower bounds
# only, no upper cap, so bumping is safe) and by a clean `pip install`
# (no dependency-resolver conflict) plus `airflow version` +
# `airflow providers list` verified working in this session.
#
# The `apt-get install --only-upgrade` block (curl/libssl3, the two
# Debian-OS-level CVEs Trivy found in this image's base Debian 12 layer)
# follows the official "Adding new apt package" example verbatim
# (https://airflow.apache.org/docs/docker-stack/build.html, "Extending the
# image" section: USER root -> apt-get update/install/autoremove/clean ->
# USER airflow) — these two packages are genuinely part of the image's
# OS layer (curl/openssl are on PATH and dynamically linked by Python's
# own SSL bindings), not dead weight, so they are upgraded in place rather
# than suppressed.
#
# apache-airflow-providers-apache-kafka==1.15.0: latest stable release on
# PyPI at the time of writing (fetched live via PyPI's JSON API in this
# session), declares `apache-airflow>=2.11.0` as its floor — compatible
# with 3.2.2. Provides ConsumeFromTopicOperator, used by
# gitops/data/airflow's mounted DAG to read the "order-events" topic
# (docs/vision.md: "Airflow | Nightly batch ETL: aggregate events into
# sales reports").
#
# No DAG file is baked into this image — see
# docs/adr/018-airflow-dag-configmap-delivery.md for why DAG delivery is a
# separate, Git-versioned ConfigMap mount instead.
FROM apache/airflow:slim-3.2.2
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends --only-upgrade \
         curl libssl3 \
  && apt-get autoremove -yqq --purge \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
USER airflow

RUN pip install --no-cache-dir \
    "apache-airflow==3.2.2" \
    apache-airflow-providers-apache-kafka==1.15.0 \
    apache-airflow-providers-postgres \
    apache-airflow-providers-fab \
    "cryptography>=50.0.0" \
    "python-multipart>=0.0.30" \
    "starlette>=1.3.1"
