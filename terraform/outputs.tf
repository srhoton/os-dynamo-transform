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
