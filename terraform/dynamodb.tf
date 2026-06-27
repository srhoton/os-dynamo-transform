locals {
  common_tags = {
    Environment = var.environment
    Project     = "os-dynamo-transform"
    ManagedBy   = "terraform"
  }
}

resource "aws_dynamodb_table" "invoice" {
  name         = "invoice"
  billing_mode = var.billing_mode
  hash_key     = "invoice_id"

  attribute {
    name = "invoice_id"
    type = "S"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = local.common_tags
}

resource "aws_dynamodb_table" "work_order" {
  name         = "work_order"
  billing_mode = var.billing_mode
  hash_key     = "work_order_id"

  attribute {
    name = "work_order_id"
    type = "S"
  }

  attribute {
    name = "invoice_id"
    type = "S"
  }

  global_secondary_index {
    name            = "invoice_id-index"
    hash_key        = "invoice_id"
    projection_type = "ALL"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = local.common_tags
}
