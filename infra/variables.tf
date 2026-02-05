# =============================================================================
# Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "default"
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "opuspopuli"
}

variable "stage" {
  description = "Deployment stage (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "ssh_key_name" {
  description = "Name of the SSH key pair in AWS"
  type        = string
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed for SSH/admin access (e.g., '203.0.113.50/32' for your IP)"
  type        = string

  validation {
    condition     = var.allowed_ssh_cidr != "0.0.0.0/0"
    error_message = "allowed_ssh_cidr cannot be 0.0.0.0/0. Please restrict to your IP address (e.g., '203.0.113.50/32'). Find your IP at https://ifconfig.me"
  }
}

variable "app_server_instance_type" {
  description = "Instance type for application server"
  type        = string
  default     = "t3.xlarge" # 4 vCPU, 16GB RAM
}

variable "gpu_server_instance_type" {
  description = "Instance type for GPU server"
  type        = string
  default     = "g5.xlarge" # 1 GPU, 4 vCPU, 16GB RAM
}

variable "gpu_spot_max_price" {
  description = "Maximum spot price for GPU instance (on-demand is ~$1.00)"
  type        = string
  default     = "0.60"
}

variable "app_server_volume_size" {
  description = "Root volume size for app server (GB)"
  type        = number
  default     = 200
}

variable "gpu_server_volume_size" {
  description = "Root volume size for GPU server (GB)"
  type        = number
  default     = 200
}

# -----------------------------------------------------------------------------
# Backup Configuration
# -----------------------------------------------------------------------------

variable "backup_retention_days" {
  description = "Number of days to retain EBS snapshots"
  type        = number
  default     = 7
}

# -----------------------------------------------------------------------------
# HTTPS/TLS Configuration (Optional)
# -----------------------------------------------------------------------------

variable "domain_name" {
  description = "Base domain name for HTTPS (e.g., yourdomain.com). Leave empty to disable HTTPS."
  type        = string
  default     = ""
}

variable "app_subdomain" {
  description = "Subdomain for app server (e.g., 'api' for api.yourdomain.com)"
  type        = string
  default     = "api"
}

variable "gpu_subdomain" {
  description = "Subdomain for GPU server (e.g., 'gpu' for gpu.yourdomain.com)"
  type        = string
  default     = "gpu"
}

variable "certbot_email" {
  description = "Email for Let's Encrypt certificate notifications"
  type        = string
  default     = ""
}
