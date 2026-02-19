# =============================================================================
# OPUSPOPULI Infrastructure Makefile
# =============================================================================
# Simple commands for deploying and managing AWS infrastructure
# =============================================================================

.PHONY: help init plan apply destroy ssh-app ssh-gpu status outputs clean

# Default values
PROJECT ?= opuspopuli
STAGE ?= dev
AWS_REGION ?= us-east-1

help:
	@echo "OPUSPOPULI Infrastructure Commands"
	@echo "================================"
	@echo ""
	@echo "Setup:"
	@echo "  make init          - Initialize Terraform"
	@echo "  make plan          - Preview infrastructure changes"
	@echo "  make apply         - Deploy infrastructure"
	@echo "  make destroy       - Destroy all infrastructure"
	@echo ""
	@echo "Operations:"
	@echo "  make ssh-app       - SSH into app server"
	@echo "  make ssh-gpu       - SSH into GPU server"
	@echo "  make status        - Show instance status"
	@echo "  make outputs       - Show Terraform outputs"
	@echo "  make logs-app      - View app server setup logs"
	@echo "  make logs-gpu      - View GPU server setup logs"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean         - Clean Terraform files"
	@echo "  make fmt           - Format Terraform files"
	@echo ""
	@echo "Variables:"
	@echo "  PROJECT=$(PROJECT) STAGE=$(STAGE) AWS_REGION=$(AWS_REGION)"

# =============================================================================
# Setup Commands
# =============================================================================

init:
	terraform init

plan:
	terraform plan \
		-var="project=$(PROJECT)" \
		-var="stage=$(STAGE)" \
		-var="aws_region=$(AWS_REGION)" \
		-out=terraform.tfplan

apply:
	@if [ ! -f terraform.tfplan ]; then \
		echo "Run 'make plan' first"; \
		exit 1; \
	fi
	terraform apply terraform.tfplan
	@echo ""
	@echo "=========================================="
	@echo "Deployment complete! Wait 5-10 minutes for services to start."
	@echo "=========================================="
	@echo ""
	@make outputs

destroy:
	terraform destroy \
		-var="project=$(PROJECT)" \
		-var="stage=$(STAGE)" \
		-var="aws_region=$(AWS_REGION)"

# =============================================================================
# Operations Commands
# =============================================================================

ssh-app:
	@APP_IP=$$(terraform output -raw app_server_ip 2>/dev/null) && \
	echo "Connecting to app server at $$APP_IP..." && \
	ssh -o StrictHostKeyChecking=no ubuntu@$$APP_IP

ssh-gpu:
	@GPU_IP=$$(terraform output -raw gpu_server_ip 2>/dev/null) && \
	echo "Connecting to GPU server at $$GPU_IP..." && \
	ssh -o StrictHostKeyChecking=no ubuntu@$$GPU_IP

status:
	@echo "Instance Status"
	@echo "==============="
	@echo ""
	@echo "App Server:"
	@terraform output app_server_ip 2>/dev/null || echo "  Not deployed"
	@echo ""
	@echo "GPU Server:"
	@terraform output gpu_server_ip 2>/dev/null || echo "  Not deployed"

outputs:
	@echo ""
	@echo "Infrastructure Outputs"
	@echo "======================"
	@echo ""
	terraform output

logs-app:
	@APP_IP=$$(terraform output -raw app_server_ip 2>/dev/null) && \
	ssh -o StrictHostKeyChecking=no ubuntu@$$APP_IP "sudo tail -f /var/log/user-data.log"

logs-gpu:
	@GPU_IP=$$(terraform output -raw gpu_server_ip 2>/dev/null) && \
	ssh -o StrictHostKeyChecking=no ubuntu@$$GPU_IP "sudo tail -f /var/log/user-data.log"

# =============================================================================
# Maintenance Commands
# =============================================================================

clean:
	rm -rf .terraform
	rm -f terraform.tfplan
	rm -f terraform.tfstate*
	rm -f .terraform.lock.hcl

fmt:
	terraform fmt -recursive

# =============================================================================
# Quick Deploy (for development)
# =============================================================================

quick-deploy: init
	terraform apply \
		-var="project=$(PROJECT)" \
		-var="stage=$(STAGE)" \
		-var="aws_region=$(AWS_REGION)" \
		-auto-approve
	@echo ""
	@make outputs
