locals {
  lambda_name    = "os-dynamo-transform-stream-processor"
  lambda_src_dir = "${path.module}/../stream_lambda"
}

# Build the TypeScript Lambda as part of `terraform apply`. Installs deps and
# bundles to stream_lambda/dist. Rebuilds whenever the source or dependency
# manifests change.
resource "null_resource" "build" {
  triggers = {
    src_hash     = sha1(join("", [for f in fileset("${local.lambda_src_dir}/src", "**") : filesha1("${local.lambda_src_dir}/src/${f}")]))
    package      = filesha1("${local.lambda_src_dir}/package.json")
    package_lock = filesha1("${local.lambda_src_dir}/package-lock.json")
  }

  provisioner "local-exec" {
    working_dir = local.lambda_src_dir
    command     = "npm ci && npm run build"
  }
}

# Zip the built bundle. depends_on defers the read until after the build runs.
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${local.lambda_src_dir}/dist"
  output_path = "${local.lambda_src_dir}/build/lambda.zip"

  depends_on = [null_resource.build]
}

resource "aws_iam_role" "lambda" {
  name = local.lambda_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Data-plane access to OpenSearch Serverless. Required in addition to being a
# principal in the collection's data access policy (see opensearch.tf); without
# aoss:APIAccessAll the collection returns 403.
resource "aws_iam_role_policy" "lambda_aoss" {
  name = "aoss-data-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["aoss:APIAccessAll"]
        Resource = [aws_opensearchserverless_collection.main.arn]
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_name}"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_lambda_function" "stream_processor" {
  function_name    = local.lambda_name
  description      = "Indexes DynamoDB stream records into OpenSearch by stream name"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "handler.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = aws_opensearchserverless_collection.main.collection_endpoint
      NODE_OPTIONS        = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda_aoss,
  ]

  tags = local.common_tags
}
