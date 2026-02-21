# =============================================================================
# CloudWatch Monitoring & Alarms
# =============================================================================

# -----------------------------------------------------------------------------
# SNS Topic for Alerts (optional - configure email subscription manually)
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.project}-${var.stage}-alerts"

  tags = {
    Name    = "${var.project}-${var.stage}-alerts"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# App Server Alarms
# -----------------------------------------------------------------------------

# CPU utilization alarm
resource "aws_cloudwatch_metric_alarm" "app_server_cpu" {
  alarm_name          = "${var.project}-${var.stage}-app-server-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "App server CPU utilization exceeds 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.app_server.id
  }

  tags = {
    Name    = "${var.project}-${var.stage}-app-server-cpu"
    Project = var.project
    Stage   = var.stage
  }
}

# Instance status check alarm
resource "aws_cloudwatch_metric_alarm" "app_server_status" {
  alarm_name          = "${var.project}-${var.stage}-app-server-status"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "App server failed status check"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.app_server.id
  }

  tags = {
    Name    = "${var.project}-${var.stage}-app-server-status"
    Project = var.project
    Stage   = var.stage
  }
}

# Disk usage alarm (requires CloudWatch agent, but alarm is ready)
resource "aws_cloudwatch_metric_alarm" "app_server_disk" {
  alarm_name          = "${var.project}-${var.stage}-app-server-disk"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "disk_used_percent"
  namespace           = "CWAgent"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "App server disk usage exceeds 85%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching" # Don't alarm if agent not installed

  dimensions = {
    InstanceId = aws_instance.app_server.id
    path       = "/"
    fstype     = "ext4"
  }

  tags = {
    Name    = "${var.project}-${var.stage}-app-server-disk"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# GPU Server Alarms
# -----------------------------------------------------------------------------

# GPU server status check alarm
resource "aws_cloudwatch_metric_alarm" "gpu_server_status" {
  alarm_name          = "${var.project}-${var.stage}-gpu-server-status"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "GPU server failed status check (may indicate spot interruption)"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_spot_instance_request.gpu_server.spot_instance_id
  }

  tags = {
    Name    = "${var.project}-${var.stage}-gpu-server-status"
    Project = var.project
    Stage   = var.stage
  }
}

# GPU server CPU alarm
resource "aws_cloudwatch_metric_alarm" "gpu_server_cpu" {
  alarm_name          = "${var.project}-${var.stage}-gpu-server-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 90
  alarm_description   = "GPU server CPU utilization exceeds 90%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_spot_instance_request.gpu_server.spot_instance_id
  }

  tags = {
    Name    = "${var.project}-${var.stage}-gpu-server-cpu"
    Project = var.project
    Stage   = var.stage
  }
}

# -----------------------------------------------------------------------------
# Spot Instance Interruption Warning
# -----------------------------------------------------------------------------

# EventBridge rule for spot instance interruption warnings
resource "aws_cloudwatch_event_rule" "spot_interruption" {
  name        = "${var.project}-${var.stage}-spot-interruption"
  description = "Capture EC2 Spot Instance Interruption Warnings"

  event_pattern = jsonencode({
    source      = ["aws.ec2"]
    detail-type = ["EC2 Spot Instance Interruption Warning"]
  })

  tags = {
    Name    = "${var.project}-${var.stage}-spot-interruption"
    Project = var.project
    Stage   = var.stage
  }
}

resource "aws_cloudwatch_event_target" "spot_interruption_sns" {
  rule      = aws_cloudwatch_event_rule.spot_interruption.name
  target_id = "send-to-sns"
  arn       = aws_sns_topic.alerts.arn
}

# Allow EventBridge to publish to SNS
resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowEventBridge"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.alerts.arn
      }
    ]
  })
}
