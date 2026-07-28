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
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
