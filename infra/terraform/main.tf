# Free-tier hosting for DataCollab:
#   Neon (PostgreSQL + pgvector)  ->  Render free web service (API + in-process worker)
#   Upstash Redis (cache, rate limits, Socket.io fan-out)
#   Vercel Hobby (static frontend)
# See README.md in this directory for what still has to be done by hand.

provider "vercel" {
  api_token = var.vercel_api_token
}

provider "render" {
  api_key  = var.render_api_key
  owner_id = var.render_owner_id
}

provider "neon" {
  api_key = var.neon_api_key
}

provider "upstash" {
  email   = var.upstash_email
  api_key = var.upstash_api_key
}

# ---------- PostgreSQL (Neon free plan) ----------

resource "neon_project" "db" {
  name       = var.project_name
  pg_version = 16
  region_id  = var.neon_region

  branch {
    name          = "main"
    database_name = "datacollab"
    role_name     = "datacollab_owner"
  }
}

locals {
  db_host = neon_project.db.database_host
  # The owner role runs migrations; it can create the read-only role and per-workspace roles.
  database_url        = "postgresql://${neon_project.db.database_user}:${neon_project.db.database_password}@${local.db_host}/${neon_project.db.database_name}?sslmode=require"
  database_reader_url = "postgresql://datacollab_reader:${var.reader_password}@${local.db_host}/${neon_project.db.database_name}?sslmode=require"
}

# ---------- Redis (Upstash free plan) ----------

resource "upstash_redis_database" "cache" {
  database_name  = "${var.project_name}-cache"
  region         = "global"
  primary_region = var.upstash_region
  tls            = true
  eviction       = true
}

locals {
  redis_url = "rediss://default:${upstash_redis_database.cache.password}@${upstash_redis_database.cache.endpoint}:${upstash_redis_database.cache.port}"
}

# ---------- API (Render free web service, Docker) ----------

resource "render_web_service" "api" {
  name   = "${var.project_name}-api"
  plan   = "free"
  region = var.render_region

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/${var.github_repo}"
      branch          = var.branch
      context         = "./backend"
      dockerfile_path = "./backend/Dockerfile"
      # Deploys are triggered by CI after tests pass (see .github/workflows/deploy.yml).
      auto_deploy = false
    }
  }

  health_check_path = "/health"

  env_vars = {
    NODE_ENV            = { value = "production" }
    DATABASE_URL        = { value = local.database_url }
    DATABASE_READER_URL = { value = local.database_reader_url }
    REDIS_URL           = { value = local.redis_url }
    JWT_SECRET          = { value = var.jwt_secret }
    GEMINI_API_KEY      = { value = var.gemini_api_key }
    FRONTEND_URL        = { value = "https://${var.project_name}.vercel.app" }
    RUN_MIGRATIONS      = { value = "true" }
    # Free web services cannot have background workers; ingestion runs in-process.
    INGEST_QUEUE        = { value = "inline" }
    RUN_WORKER_IN_API   = { value = "false" }
    EMBEDDINGS_PROVIDER = { value = "local" }
    DEMO_PASSWORD       = { value = var.demo_password }
    SEED_DEMO           = { value = "true" }
  }
}

# ---------- Frontend (Vercel Hobby) ----------

# Not connected to the Git repository on purpose: production deploys come from the deploy
# workflow (Vercel CLI) after CI passes, instead of on every push.
resource "vercel_project" "web" {
  name             = var.project_name
  framework        = "vite"
  build_command    = "npm run build"
  output_directory = "build"
}

resource "vercel_project_environment_variable" "api_url" {
  project_id = vercel_project.web.id
  key        = "VITE_API_URL"
  value      = render_web_service.api.url
  target     = ["production", "preview"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "socket_url" {
  project_id = vercel_project.web.id
  key        = "VITE_SOCKET_URL"
  value      = render_web_service.api.url
  target     = ["production", "preview"]
  sensitive  = false
}
