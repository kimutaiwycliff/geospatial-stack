# Multi-stage build: compile the Vite/React SPA with Node, then serve the
# static `dist/` output with a minimal nginx -- no Node (or any build
# tooling) needed in the runtime image, matching docker-compose.yml's `web`
# service, which builds this context and has no ports of its own (Caddy is
# the only thing that exposes ports, per brief §10).

FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached by Docker as long as
# dependencies haven't changed, independent of app source edits. `scripts/`
# has to come along too -- `npm ci` runs the `postinstall` script (see
# package.json), which needs scripts/copy-maplibre-worker.mjs to already
# exist; without this, npm ci fails with "module not found" every time,
# since the rest of the source isn't copied in until after this layer.
COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/
RUN npm ci

COPY . .
# Vite inlines VITE_-prefixed env vars into the built bundle at build time
# (not read at container runtime like every other service's env_file) --
# an ARG + ENV pair is the only way a build-time value reaches `npm run
# build` here. Defaults to empty (same no-op-until-set contract as every
# other Sentry DSN in this stack, see src/main.tsx) so a plain `docker
# compose build` with no build-arg still produces a working image.
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
