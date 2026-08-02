# Multi-stage build per https://docs.docker.com/build/building/multi-stage/.
# This service has zero runtime dependencies today (plain Node.js process),
# so `npm ci --omit=dev` produces no node_modules to carry into the runtime
# stage. The two-stage shape is kept anyway for consistency with the other
# three services and to make the Phase 6 RabbitMQ addition a drop-in change.
FROM node:22.23.2-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

FROM node:22.23.2-alpine3.24 AS runtime
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src

# Run as the "node" user pre-created by the official image rather than root,
# per https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
# ("Non-root user"). No custom uid/gid needed.
USER node

CMD ["node", "src/index.js"]
