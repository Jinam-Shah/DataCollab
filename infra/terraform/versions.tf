terraform {
  required_version = ">= 1.6"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.22"
    }
    render = {
      source  = "render-oss/render"
      version = "~> 1.9"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.18"
    }
    upstash = {
      source  = "upstash/upstash"
      version = "~> 2.1"
    }
  }
}
