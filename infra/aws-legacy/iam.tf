# =============================================================================
# IAM Roles and Policies
# =============================================================================

# -----------------------------------------------------------------------------
# EC2 Instance Role
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ec2_role" {
  name = "${var.project}-${var.stage}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name    = "${var.project}-${var.stage}-ec2-role"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# Policy Attachments
# -----------------------------------------------------------------------------

# SSM for remote management
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# -----------------------------------------------------------------------------
# Inline Policies
# -----------------------------------------------------------------------------

# Access to Secrets Manager
resource "aws_iam_role_policy" "secrets_access" {
  name = "${var.project}-${var.stage}-secrets-access"
  role = aws_iam_role.ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.app_secrets.arn
        ]
      }
    ]
  })
}

# Access to ECR for pulling container images
resource "aws_iam_role_policy" "ecr_access" {
  name = "${var.project}-${var.stage}-ecr-access"
  role = aws_iam_role.ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = ["*"]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Instance Profile
# -----------------------------------------------------------------------------

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project}-${var.stage}-ec2-profile"
  role = aws_iam_role.ec2_role.name
}
