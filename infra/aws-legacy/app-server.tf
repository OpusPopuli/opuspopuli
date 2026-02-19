# =============================================================================
# Application Server
# =============================================================================
# Runs: Supabase stack, Redis, ChromaDB, and your applications
# Instance: t3.xlarge (4 vCPU, 16GB RAM) - handles 100-500 concurrent users

resource "aws_instance" "app_server" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.app_server_instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.app_server.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  key_name               = var.ssh_key_name

  root_block_device {
    volume_size           = var.app_server_volume_size
    volume_type           = "gp3"
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/scripts/app-server.sh", {
    aws_region    = var.aws_region
    secret_arn    = aws_secretsmanager_secret.app_secrets.arn
    project       = var.project
    stage         = var.stage
    gpu_server_ip = aws_eip.gpu_server.public_ip
    # HTTPS/TLS configuration
    domain_name   = var.domain_name
    app_subdomain = var.app_subdomain
    certbot_email = var.certbot_email
  })

  tags = {
    Name    = "${var.project}-${var.stage}-app-server"
    Project = var.project
    Stage   = var.stage
  }

  depends_on = [aws_eip.gpu_server]
}

# -----------------------------------------------------------------------------
# Elastic IP
# -----------------------------------------------------------------------------

resource "aws_eip" "app_server" {
  instance = aws_instance.app_server.id
  domain   = "vpc"

  tags = {
    Name    = "${var.project}-${var.stage}-app-eip"
    Project = var.project
    Stage   = var.stage
  }
}
