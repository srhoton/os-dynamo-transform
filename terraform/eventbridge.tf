# Custom event bus that receives DynamoDB stream records from the pipes.
resource "aws_cloudwatch_event_bus" "main" {
  name = "os-dynamo-transform-bus"
  tags = local.common_tags
}

# Execution role assumed by the EventBridge Pipes to read the DynamoDB streams
# and put events onto the custom bus.
resource "aws_iam_role" "pipe" {
  name = "os-dynamo-transform-pipe"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "pipes.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "pipe" {
  name = "os-dynamo-transform-pipe"
  role = aws_iam_role.pipe.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
        ]
        Resource = [
          aws_dynamodb_table.invoice.stream_arn,
          aws_dynamodb_table.work_order.stream_arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = [aws_cloudwatch_event_bus.main.arn]
      },
    ]
  })
}

# One pipe per DynamoDB stream (a pipe has exactly one source). Both pipes emit
# events with the same `source` so a single rule can route both to the Lambda;
# the Lambda derives the target index from each record's eventSourceARN.
resource "aws_pipes_pipe" "invoice" {
  name     = "os-dynamo-transform-invoice"
  role_arn = aws_iam_role.pipe.arn
  source   = aws_dynamodb_table.invoice.stream_arn
  target   = aws_cloudwatch_event_bus.main.arn

  source_parameters {
    dynamodb_stream_parameters {
      starting_position = "LATEST"
      batch_size        = 10
    }
  }

  target_parameters {
    eventbridge_event_bus_parameters {
      source      = "os-dynamo-transform.dynamodb"
      detail_type = "invoice-record"
    }
  }

  tags = local.common_tags
}

resource "aws_pipes_pipe" "work_order" {
  name     = "os-dynamo-transform-work-order"
  role_arn = aws_iam_role.pipe.arn
  source   = aws_dynamodb_table.work_order.stream_arn
  target   = aws_cloudwatch_event_bus.main.arn

  source_parameters {
    dynamodb_stream_parameters {
      starting_position = "LATEST"
      batch_size        = 10
    }
  }

  target_parameters {
    eventbridge_event_bus_parameters {
      source      = "os-dynamo-transform.dynamodb"
      detail_type = "work-order-record"
    }
  }

  tags = local.common_tags
}

# Rule on the custom bus that forwards every DynamoDB stream event to the Lambda.
resource "aws_cloudwatch_event_rule" "to_lambda" {
  name           = "os-dynamo-transform-to-lambda"
  description    = "Routes DynamoDB stream events from the pipes to the stream processor Lambda"
  event_bus_name = aws_cloudwatch_event_bus.main.name

  event_pattern = jsonencode({
    source = ["os-dynamo-transform.dynamodb"]
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule           = aws_cloudwatch_event_rule.to_lambda.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_lambda_function.stream_processor.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.stream_processor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.to_lambda.arn
}
