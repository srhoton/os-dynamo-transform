# Deploy-time provisioning of OpenSearch data-plane objects (indexes, the
# combined nested index, and aliases) that the Terraform AWS provider cannot
# manage directly. Implemented as a bootstrap Lambda invoked on apply, reusing
# the stream Lambda's package, role, and OpenSearch client.

resource "aws_cloudwatch_log_group" "bootstrap" {
  name              = "/aws/lambda/os-dynamo-transform-bootstrap"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_lambda_function" "bootstrap" {
  function_name    = "os-dynamo-transform-bootstrap"
  description      = "Creates OpenSearch indexes and aliases for the transform POC"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "bootstrap.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 60
  memory_size      = 256

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = aws_opensearchserverless_collection.main.collection_endpoint
      NODE_OPTIONS        = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.bootstrap,
    aws_iam_role_policy.lambda_aoss,
  ]

  tags = local.common_tags
}

# Run the bootstrap on apply. The input carries the bundle hash so the
# invocation re-runs whenever the Lambda code changes; the handler is
# idempotent, so re-running is safe. depends_on the data access policy so the
# Lambda role is an authorized principal before it calls the collection.
resource "aws_lambda_invocation" "bootstrap" {
  function_name = aws_lambda_function.bootstrap.function_name

  input = jsonencode({
    trigger = data.archive_file.lambda.output_base64sha256
  })

  depends_on = [aws_opensearchserverless_access_policy.main]
}
