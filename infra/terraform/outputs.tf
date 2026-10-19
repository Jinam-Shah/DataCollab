output "api_url" {
  value = render_web_service.api.url
}

output "frontend_project" {
  value = vercel_project.web.name
}

output "neon_host" {
  value = neon_project.db.database_host
}
