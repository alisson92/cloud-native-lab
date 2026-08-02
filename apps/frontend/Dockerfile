# Multi-stage build per https://docs.docker.com/build/building/multi-stage/:
# the "build" stage installs dependencies, the "runtime" stage copies only
# what's needed to run, keeping the final image small and dependency-free of
# npm/build tooling. No frontend build toolchain (no React/webpack/vite) —
# the "public" directory is served as-is.
FROM node:22.23.2-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public

FROM node:22.23.2-alpine3.24 AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public

# Run as the "node" user pre-created by the official image rather than root,
# per https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
# ("Non-root user"). No custom uid/gid needed.
USER node

EXPOSE 8082

CMD ["node", "src/index.js"]
