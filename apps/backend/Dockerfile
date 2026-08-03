# Multi-stage build per https://docs.docker.com/build/building/multi-stage/:
# the "build" stage installs dependencies, the "runtime" stage copies only
# what's needed to run, keeping the final image small and dependency-free of
# npm/build tooling.
#
# alpine3.24 (>= Alpine 3.20): @confluentinc/kafka-javascript (Phase 6 batch
# 2, kafka.js) ships prebuilt musl binaries via node-pre-gyp for Alpine
# 3.20+ / Node 18-24 (confirmed against the package's own docs/examples in
# this session), so plain `npm ci` below needs no extra apk build-deps
# (python3/make/g++/openssl-dev/...) — those are only required on older
# Alpine bases without a matching prebuilt binary.
FROM node:22.23.2-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

FROM node:22.23.2-alpine3.24 AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src

# Run as the "node" user pre-created by the official image rather than root,
# per https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
# ("Non-root user"). No custom uid/gid needed.
USER node

EXPOSE 8080

CMD ["node", "src/index.js"]
