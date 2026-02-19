# =============================================================================
# OPUSPOPULI Infrastructure Outputs
# =============================================================================

# VPC
output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnets" {
  description = "Public subnet IDs"
  value       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

# Application Server
output "app_server_id" {
  description = "Application server instance ID"
  value       = aws_instance.app_server.id
}

output "app_server_ip" {
  description = "Application server public IP"
  value       = aws_eip.app_server.public_ip
}

output "app_server_private_ip" {
  description = "Application server private IP"
  value       = aws_instance.app_server.private_ip
}

# GPU Server
output "gpu_server_request_id" {
  description = "GPU spot instance request ID"
  value       = aws_spot_instance_request.gpu_server.id
}

output "gpu_server_instance_id" {
  description = "GPU server instance ID"
  value       = aws_spot_instance_request.gpu_server.spot_instance_id
}

output "gpu_server_ip" {
  description = "GPU server public IP"
  value       = aws_eip.gpu_server.public_ip
}

# URLs (conditional HTTPS when domain is configured)
output "supabase_studio_url" {
  description = "Supabase Studio URL"
  value       = "http://${aws_eip.app_server.public_ip}:3000"
}

output "supabase_api_url" {
  description = "Supabase API URL"
  value       = var.domain_name != "" ? "https://${var.app_subdomain}.${var.domain_name}" : "http://${aws_eip.app_server.public_ip}"
}

output "vllm_api_url" {
  description = "vLLM API URL (OpenAI-compatible)"
  value       = var.domain_name != "" ? "https://${var.gpu_subdomain}.${var.domain_name}/v1" : "http://${aws_eip.gpu_server.public_ip}:8000"
}

output "embeddings_api_url" {
  description = "Embeddings API URL"
  value       = var.domain_name != "" ? "https://${var.gpu_subdomain}.${var.domain_name}/embeddings" : "http://${aws_eip.gpu_server.public_ip}:8001"
}

# SSH Commands
output "ssh_app_server" {
  description = "SSH command for app server"
  value       = "ssh -i <your-key.pem> ubuntu@${aws_eip.app_server.public_ip}"
}

output "ssh_gpu_server" {
  description = "SSH command for GPU server"
  value       = "ssh -i <your-key.pem> ubuntu@${aws_eip.gpu_server.public_ip}"
}

# Secrets
output "secrets_arn" {
  description = "AWS Secrets Manager ARN"
  value       = aws_secretsmanager_secret.app_secrets.arn
  sensitive   = true
}

# Monitoring
output "alerts_sns_topic_arn" {
  description = "SNS topic ARN for alerts (subscribe your email to receive notifications)"
  value       = aws_sns_topic.alerts.arn
}

# Backup
output "backup_vault_arn" {
  description = "AWS Backup vault ARN"
  value       = aws_backup_vault.main.arn
}

output "backup_plan_id" {
  description = "AWS Backup plan ID"
  value       = aws_backup_plan.daily.id
}

# Backend Environment Variables
output "backend_env_vars" {
  description = "Environment variables for backend configuration"
  value = {
    SUPABASE_URL          = var.domain_name != "" ? "https://${var.app_subdomain}.${var.domain_name}" : "http://${aws_eip.app_server.public_ip}"
    VECTOR_DB_PROVIDER    = "pgvector"
    LLM_URL               = var.domain_name != "" ? "https://${var.gpu_subdomain}.${var.domain_name}/v1" : "http://${aws_eip.gpu_server.public_ip}:8000"
    EMBEDDINGS_PROVIDER   = "ollama"
    EMBEDDINGS_OLLAMA_URL = var.domain_name != "" ? "https://${var.gpu_subdomain}.${var.domain_name}/embeddings" : "http://${aws_eip.gpu_server.public_ip}:8001"
    RELATIONAL_DB_HOST    = aws_eip.app_server.public_ip
    RELATIONAL_DB_PORT    = "5432"
  }
  sensitive = false
}
