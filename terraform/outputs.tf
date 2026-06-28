output "invoice_table_arn" {
  description = "ARN of the invoice DynamoDB table"
  value       = aws_dynamodb_table.invoice.arn
}

output "invoice_stream_arn" {
  description = "Stream ARN of the invoice DynamoDB table"
  value       = aws_dynamodb_table.invoice.stream_arn
}

output "work_order_table_arn" {
  description = "ARN of the work_order DynamoDB table"
  value       = aws_dynamodb_table.work_order.arn
}

output "work_order_stream_arn" {
  description = "Stream ARN of the work_order DynamoDB table"
  value       = aws_dynamodb_table.work_order.stream_arn
}

output "opensearch_collection_arn" {
  description = "ARN of the OpenSearch Serverless collection"
  value       = aws_opensearchserverless_collection.main.arn
}

output "opensearch_collection_endpoint" {
  description = "HTTPS endpoint for indexing into the OpenSearch Serverless collection"
  value       = aws_opensearchserverless_collection.main.collection_endpoint
}

output "opensearch_dashboard_endpoint" {
  description = "OpenSearch Dashboards endpoint for the collection"
  value       = aws_opensearchserverless_collection.main.dashboard_endpoint
}

output "eventbridge_bus_arn" {
  description = "ARN of the custom EventBridge bus receiving DynamoDB stream events"
  value       = aws_cloudwatch_event_bus.main.arn
}

output "lambda_function_name" {
  description = "Name of the stream processor Lambda function"
  value       = aws_lambda_function.stream_processor.function_name
}

output "lambda_function_arn" {
  description = "ARN of the stream processor Lambda function"
  value       = aws_lambda_function.stream_processor.arn
}

output "unified_alias" {
  description = "Option 1: alias spanning both indexes for unified querying"
  value       = "transactions"
}

output "index_aliases" {
  description = "Option 1: per-index aliases abstracting the physical index names"
  value       = ["invoice", "work_order"]
}

output "combined_index" {
  description = "Option 2: denormalized index where each invoice holds a nested work_orders array"
  value       = "invoice-combined"
}
