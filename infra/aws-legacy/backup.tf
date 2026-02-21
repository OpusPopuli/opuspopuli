# =============================================================================
# EBS Backup Strategy using AWS Backup
# =============================================================================
# Daily automated snapshots with configurable retention
# Cost: ~$0.05/GB-month for stored snapshots (incremental after first)
# =============================================================================

# -----------------------------------------------------------------------------
# AWS Backup Vault
# -----------------------------------------------------------------------------

resource "aws_backup_vault" "main" {
  name = "${var.project}-${var.stage}-backup-vault"

  tags = {
    Name    = "${var.project}-${var.stage}-backup-vault"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# AWS Backup Plan
# -----------------------------------------------------------------------------

resource "aws_backup_plan" "daily" {
  name = "${var.project}-${var.stage}-daily-backup"

  rule {
    rule_name         = "daily-backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 5 * * ? *)" # Daily at 5 AM UTC

    lifecycle {
      delete_after = var.backup_retention_days
    }

    # Copy to another region for disaster recovery (optional)
    # copy_action {
    #   destination_vault_arn = "arn:aws:backup:us-west-2:ACCOUNT:backup-vault:DR-vault"
    # }
  }

  tags = {
    Name    = "${var.project}-${var.stage}-daily-backup"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# IAM Role for AWS Backup
# -----------------------------------------------------------------------------

resource "aws_iam_role" "backup" {
  name = "${var.project}-${var.stage}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name    = "${var.project}-${var.stage}-backup-role"
    Project = var.project
    Stage   = var.stage
  }
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "backup_restores" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

# -----------------------------------------------------------------------------
# Backup Selection - Target EC2 Instances
# -----------------------------------------------------------------------------

resource "aws_backup_selection" "servers" {
  name         = "${var.project}-${var.stage}-servers"
  plan_id      = aws_backup_plan.daily.id
  iam_role_arn = aws_iam_role.backup.arn

  # Select resources by tag
  selection_tag {
    type  = "STRINGEQUALS"
    key   = "Project"
    value = var.project
  }

  # Also select by specific resource ARNs for more precision
  resources = [
    aws_instance.app_server.arn,
    # Note: Spot instances are handled differently - we backup their EBS volumes
  ]
}

# -----------------------------------------------------------------------------
# Backup Selection for GPU Server EBS Volume
# -----------------------------------------------------------------------------
# Spot instances can be interrupted, so we directly backup the EBS volume
# to ensure data is preserved even if the spot instance is terminated

data "aws_ebs_volume" "gpu_server" {
  most_recent = true

  filter {
    name   = "attachment.instance-id"
    values = [aws_spot_instance_request.gpu_server.spot_instance_id]
  }

  filter {
    name   = "attachment.device"
    values = ["/dev/sda1", "/dev/xvda"]
  }

  depends_on = [aws_spot_instance_request.gpu_server]
}

resource "aws_backup_selection" "gpu_volume" {
  name         = "${var.project}-${var.stage}-gpu-volume"
  plan_id      = aws_backup_plan.daily.id
  iam_role_arn = aws_iam_role.backup.arn

  resources = [
    "arn:aws:ec2:${var.aws_region}:*:volume/${data.aws_ebs_volume.gpu_server.id}"
  ]
}
