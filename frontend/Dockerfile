# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional: behind a TLS-intercepting proxy, pass its CA with --secret id=npm_ca,src=<bundle.crt>
RUN --mount=type=secret,id=npm_ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm ci
COPY . .
# Vite inlines these at build time.
ARG VITE_API_URL=http://localhost:5000
ARG VITE_SOCKET_URL=http://localhost:5000
ENV VITE_API_URL=$VITE_API_URL VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN npm run build

# nginx-unprivileged runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 8080
