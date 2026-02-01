# =============================================================================
# QCKSTRT AWS Infrastructure - Cost-Effective MVP
# =============================================================================
#
# This configuration deploys a simple, cost-effective AWS infrastructure:
# - App Server (t3.xlarge): Runs Supabase + your applications
# - GPU Server (g5.xlarge spot): Runs vLLM + embeddings service
#
# Target specs: 10-50k users, 100-500 concurrent requests, 1M AI queries/month
# Estimated cost: ~$500-800/month
#
# File Structure:
# - main.tf             : Terraform & provider configuration (this file)
# - variables.tf        : Input variables (with security validation)
# - data.tf             : Data sources (AMIs, availability zones)
# - vpc.tf              : VPC, subnets, internet gateway, routes
# - security-groups.tf  : Security groups and rules
# - iam.tf              : IAM roles, policies, instance profile
# - secrets.tf          : Secrets Manager and random passwords
# - monitoring.tf       : CloudWatch alarms and SNS alerts
# - backup.tf           : AWS Backup for EBS snapshots
# - app-server.tf       : Application server EC2 instance
# - gpu-server.tf       : GPU spot instance for AI inference
# - outputs.tf          : Output values
#
# =============================================================================

terraform {
  required_version = ">= 1.0"

  # ---------------------------------------------------------------------------
  # Remote State Backend (S3 + DynamoDB)
  # ---------------------------------------------------------------------------
  # To enable remote state:
  #   1. cd backend-bootstrap && terraform init && terraform apply
  #   2. Uncomment the backend block below
  #   3. Replace ACCOUNT_ID with your AWS account ID from bootstrap output
  #   4. Run: terraform init -migrate-state
  # ---------------------------------------------------------------------------
  # backend "s3" {
  #   bucket         = "qckstrt-terraform-state-ACCOUNT_ID"
  #   key            = "env/dev/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "qckstrt-terraform-locks"
  # }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}
