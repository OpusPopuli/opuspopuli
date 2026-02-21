# =============================================================================
# GPU Server (Spot Instance)
# =============================================================================
# Runs: vLLM (LLM inference) + Text Embeddings Inference
# Instance: g5.xlarge (1 GPU A10G 24GB VRAM, 4 vCPU, 16GB RAM)
# Spot pricing: ~$0.30-0.60/hr vs ~$1.00/hr on-demand

resource "aws_spot_instance_request" "gpu_server" {
  ami                    = data.aws_ami.deep_learning.id
  instance_type          = var.gpu_server_instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.gpu_server.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  key_name               = var.ssh_key_name

  # Spot configuration
  spot_price                     = var.gpu_spot_max_price
  wait_for_fulfillment           = true
  spot_type                      = "persistent"
  instance_interruption_behavior = "stop" # Stop (not terminate) on interruption

  root_block_device {
    volume_size           = var.gpu_server_volume_size
    volume_type           = "gp3"
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/scripts/gpu-server.sh", {
    # HTTPS/TLS configuration
    domain_name   = var.domain_name
    gpu_subdomain = var.gpu_subdomain
    certbot_email = var.certbot_email
  })

  tags = {
    Name    = "${var.project}-${var.stage}-gpu-server"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# Elastic IP
# -----------------------------------------------------------------------------

resource "aws_eip" "gpu_server" {
  domain = "vpc"

  tags = {
    Name    = "${var.project}-${var.stage}-gpu-eip"
    Project = var.project
    Stage   = var.stage
  }
}

# Associate EIP with spot instance after it's created
resource "aws_eip_association" "gpu_server" {
  instance_id   = aws_spot_instance_request.gpu_server.spot_instance_id
  allocation_id = aws_eip.gpu_server.id
}
