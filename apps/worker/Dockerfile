# Multi-stage build per https://docs.docker.com/build/building/multi-stage/:
# the "build" stage installs dependencies, the "runtime" stage copies only
# what's needed to run. Phase 6 (docs/phases.md) adds amqplib as this
# service's first runtime dependency, so node_modules is now copied into
# the runtime stage — same shape as apps/backend/Dockerfile.
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

CMD ["node", "src/index.js"]
