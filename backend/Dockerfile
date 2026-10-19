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
ENV TRANSFORMERS_CACHE_DIR=/app/.cache/transformers
RUN mkdir -p /app/uploads /app/.cache/transformers && chown -R node:node /app/uploads /app/.cache
USER node
# Download the embedding model at build time (about 23 MB), so the first document upload does
# not wait for it and the running container never needs to write to the cache.
RUN --mount=type=secret,id=npm_ca,required=false,uid=1000 NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca \
    EMBEDDINGS_PROVIDER=local node -e "require('./dist/rag/embeddings').embedTexts(['warm up']).then(() => console.log('embedding model cached'))"
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
