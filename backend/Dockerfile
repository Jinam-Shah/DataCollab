# syntax=docker/dockerfile:1
# One image for the API and the ingestion worker (different commands).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Optional: behind a TLS-intercepting proxy, pass its CA with --secret id=npm_ca,src=<bundle.crt>
RUN --mount=type=secret,id=npm_ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    UPLOAD_DIR=/app/uploads \
    PORT=5000
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=npm_ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca \
    npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
