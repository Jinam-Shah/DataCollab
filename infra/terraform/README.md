# Terraform for the free hosting setup

Provisions the hosted pieces of DataCollab on free plans:

| Resource | Provider (registry status checked 2026-10-19) | Plan |
|---|---|---|
| `neon_project.db`: PostgreSQL 16 with a `datacollab` database | [`kislerdm/neon`](https://registry.terraform.io/providers/kislerdm/neon) 0.18 (community, released 2026-09) | Neon Free; compute scales to zero after 5 minutes idle |
| `upstash_redis_database.cache`: TLS Redis | [`upstash/upstash`](https://registry.terraform.io/providers/upstash/upstash) 2.1 (community, published by Upstash) | Free: 256 MB, 500K commands/month |
| `render_web_service.api`: Docker build of `backend/` | [`render-oss/render`](https://registry.terraform.io/providers/render-oss/render) 1.9 (partner) | Free web service: spins down after 15 min idle, about 1 min to wake |
| `vercel_project.web` + `VITE_API_URL` / `VITE_SOCKET_URL` | [`vercel/vercel`](https://registry.terraform.io/providers/vercel/vercel) 5.22 (partner) | Hobby |

State stays local (`terraform.tfstate`, git-ignored). Secrets come in as variables, ideally
`TF_VAR_*` environment variables; nothing secret is committed.

## Free-tier decisions encoded here

- **No background worker on Render.** Render's free plan covers web services, Postgres, Key Value and
  static sites only ("Other service types don't support Free instances", render.com/docs/free).
  The API therefore runs ingestion itself.
- **`INGEST_QUEUE=inline`.** An idle BullMQ worker polls Redis every few seconds, which would use up
  a large part of Upstash's 500K monthly commands. On free hosting, Redis is used only for the
  query cache, rate limits and Socket.io, and uploads are ingested in-process (same retries and
  progress events).
- **`SEED_DEMO=true`.** Free services have no shell for one-off commands, so the demo workspace
  is seeded (idempotently) when the API starts.
- **Deploys after CI.** Render auto-deploy is off, and the Vercel project is not linked to Git.
  `.github/workflows/deploy.yml` deploys once the CI workflow passes on `main`.

## Steps

1. Create free accounts on Neon, Upstash, Render and Vercel (no payment details needed).
2. Get the API keys: Neon (Account settings → API keys), Upstash (Console → Account → Management API),
   Render (Account settings → API keys; owner ID from the workspace URL, `tea-...`), Vercel (Account → Tokens).
3. In Render, connect your GitHub account so Render can read the repository.
4. Export the variables and apply:
   ```bash
   export TF_VAR_vercel_api_token=... TF_VAR_render_api_key=... TF_VAR_neon_api_key=...
   export TF_VAR_upstash_api_key=... TF_VAR_jwt_secret=$(openssl rand -hex 32)
   export TF_VAR_reader_password=$(openssl rand -hex 16) TF_VAR_gemini_api_key=...
   cp terraform.tfvars.example terraform.tfvars   # set render_owner_id and upstash_email
   terraform init && terraform apply
   ```
5. Manual steps Terraform does not cover:
   - In Render, copy the service's **Deploy Hook** URL into the GitHub secret `RENDER_DEPLOY_HOOK_URL`.
   - Add GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (from `vercel link` or the project settings).
   - If the Vercel URL is not `https://datacollab.vercel.app`, update `FRONTEND_URL` on the Render
     service (CORS and Socket.io only accept that origin).
   - Trigger the first deploy: push to `main`, or click **Manual Deploy** in Render.

## Checks

CI runs `terraform fmt -check` and `terraform validate`. `terraform plan` and `apply` need real
credentials, so they have not been run from the build environment.
