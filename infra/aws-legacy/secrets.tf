# =============================================================================
# Secrets Management
# =============================================================================

# -----------------------------------------------------------------------------
# Random Passwords
# -----------------------------------------------------------------------------

resource "random_password" "postgres_password" {
  length  = 32
  special = false # Avoid special chars for easier shell handling
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "random_password" "anon_key" {
  length  = 32
  special = false
}

resource "random_password" "service_role_key" {
  length  = 32
  special = false
}

# -----------------------------------------------------------------------------
# AWS Secrets Manager
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "app_secrets" {
  name                    = "${var.project}/${var.stage}/app-secrets"
  recovery_window_in_days = 0 # Allow immediate deletion in dev

  tags = {
    Name    = "${var.project}-${var.stage}-app-secrets"
    Project = var.project
    Stage   = var.stage
  }
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    postgres_password = random_password.postgres_password.result
    jwt_secret        = random_password.jwt_secret.result
    anon_key          = random_password.anon_key.result
    service_role_key  = random_password.service_role_key.result
  })
}
