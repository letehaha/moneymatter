# Build context is packages/docs: the docs site is a standalone npm project
# (not a root workspace) so its dependencies never touch the app's lockfile.
FROM --platform=$BUILDPLATFORM node:24.22.1 AS build-stage

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run screenshots:optimize && npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html

EXPOSE 8080
