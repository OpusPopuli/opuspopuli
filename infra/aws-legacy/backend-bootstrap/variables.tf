# =============================================================================
# Variables for Backend Bootstrap
# =============================================================================

variable "aws_region" {
  description = "AWS region for state storage"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "default"
}

variable "project" {
  description = "Project name (used in resource naming)"
  type        = string
  default     = "opuspopuli"
}
