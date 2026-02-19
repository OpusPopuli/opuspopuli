# =============================================================================
# Security Groups
# =============================================================================

# -----------------------------------------------------------------------------
# App Server Security Group
# -----------------------------------------------------------------------------

resource "aws_security_group" "app_server" {
  name        = "${var.project}-${var.stage}-app-server"
  description = "Security group for application server"
  vpc_id      = aws_vpc.main.id

  # HTTP
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Supabase Studio
  ingress {
    description = "Supabase Studio"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr] # Restrict in production
  }

  # GraphQL API
  ingress {
    description = "GraphQL API"
    from_port   = 3001
    to_port     = 3003
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  # All traffic from GPU server
  ingress {
    description     = "Traffic from GPU server"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.gpu_server.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-${var.stage}-app-server"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# GPU Server Security Group
# -----------------------------------------------------------------------------

resource "aws_security_group" "gpu_server" {
  name        = "${var.project}-${var.stage}-gpu-server"
  description = "Security group for GPU inference server"
  vpc_id      = aws_vpc.main.id

  # SSH
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  # HTTP (for Let's Encrypt certificate validation)
  ingress {
    description = "HTTP (Let's Encrypt ACME)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS (for TLS traffic when domain is configured)
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-${var.stage}-gpu-server"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# Cross-Security Group Rules (App <-> GPU)
# -----------------------------------------------------------------------------

# Allow app server to access vLLM API on GPU server
resource "aws_security_group_rule" "gpu_from_app_vllm" {
  type                     = "ingress"
  description              = "vLLM API from app server"
  from_port                = 8000
  to_port                  = 8000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app_server.id
  security_group_id        = aws_security_group.gpu_server.id
}

# Allow app server to access Embeddings API on GPU server
resource "aws_security_group_rule" "gpu_from_app_embeddings" {
  type                     = "ingress"
  description              = "Embeddings API from app server"
  from_port                = 8001
  to_port                  = 8001
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app_server.id
  security_group_id        = aws_security_group.gpu_server.id
}
