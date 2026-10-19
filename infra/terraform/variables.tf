# API credentials come from TF_VAR_* environment variables, never from committed files.
variable "vercel_api_token" {
  type      = string
  sensitive = true
}

variable "render_api_key" {
  type      = string
  sensitive = true
}

variable "render_owner_id" {
  description = "Render workspace (owner) ID, e.g. tea-xxxx"
  type        = string
}

variable "neon_api_key" {
  type      = string
  sensitive = true
}

variable "upstash_email" {
  type = string
}

variable "upstash_api_key" {
  type      = string
  sensitive = true
}

variable "github_repo" {
  description = "GitHub repository in owner/name form"
  type        = string
  default     = "Jinam-Shah/DataCollab"
}

variable "branch" {
  description = "Branch that Render and Vercel deploy"
  type        = string
  default     = "main"
}

variable "project_name" {
  type    = string
  default = "datacollab"
}

variable "neon_region" {
  description = "Neon region, close to the Render region"
  type        = string
  default     = "aws-us-east-2"
}

variable "render_region" {
  type    = string
  default = "ohio"
}

variable "upstash_region" {
  type    = string
  default = "us-east-2"
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "reader_password" {
  description = "Password for the read-only datacollab_reader role (created by migrations)"
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "demo_password" {
  type      = string
  sensitive = true
  default   = "demo1234"
}
