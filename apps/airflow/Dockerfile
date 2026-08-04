# Airflow (Phase 7, docs/phases.md): extends the official image only to add
# the one provider package it does not ship by default.
#
# Base tag "3.2.2" MUST match gitops/apps/airflow.yaml's
# `airflowVersion`/`images.airflow.tag` (both left at the official Helm
# chart's own default for chart version 1.22.0, confirmed live against
# https://airflow.apache.org/index.yaml in this session) — the chart uses
# `airflowVersion` to decide DAG-processor/scheduler behavior that only
# makes sense if it matches the image actually running.
#
# apache-airflow-providers-postgres ships in the default (non-slim)
# apache/airflow image already (confirmed via
# https://airflow.apache.org/docs/docker-stack/index.html, "the vast
# majority of `providers` package are pre-installed" in the default image),
# so only the Kafka provider needs adding here.
#
# Pattern follows the official "Extending the image" guide (not
# "Customizing", which is for packages needing compiled build tools):
# https://airflow.apache.org/docs/docker-stack/build.html
# — pinning `apache-airflow==${AIRFLOW_VERSION}` alongside the new package
# is the guide's own recommendation, to fail loudly instead of silently
# upgrading/downgrading Airflow itself if a dependency conflicts.
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
FROM apache/airflow:3.2.2

RUN pip install --no-cache-dir \
    "apache-airflow==3.2.2" \
    apache-airflow-providers-apache-kafka==1.15.0
