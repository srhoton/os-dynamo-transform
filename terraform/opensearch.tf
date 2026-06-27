data "aws_caller_identity" "current" {}

resource "aws_opensearchserverless_security_policy" "encryption" {
  name        = "os-dynamo-transform-enc"
  type        = "encryption"
  description = "Encryption policy for os-dynamo-transform collection"
  policy = jsonencode({
    Rules = [
      {
        Resource     = ["collection/os-dynamo-transform"]
        ResourceType = "collection"
      }
    ]
    AWSOwnedKey = true
  })
}

resource "aws_opensearchserverless_security_policy" "network" {
  name        = "os-dynamo-transform-net"
  type        = "network"
  description = "Network policy for os-dynamo-transform collection"
  policy = jsonencode([
    {
      Rules = [
        {
          Resource     = ["collection/os-dynamo-transform"]
          ResourceType = "collection"
        },
        {
          Resource     = ["collection/os-dynamo-transform"]
          ResourceType = "dashboard"
        }
      ]
      AllowFromPublic = true
    }
  ])
}

resource "aws_opensearchserverless_collection" "main" {
  name             = "os-dynamo-transform"
  type             = "SEARCH"
  description      = "OpenSearch Serverless collection for DynamoDB transform POC"
  standby_replicas = "DISABLED"

  depends_on = [
    aws_opensearchserverless_security_policy.encryption,
    aws_opensearchserverless_security_policy.network,
  ]

  tags = local.common_tags
}

resource "aws_opensearchserverless_access_policy" "main" {
  name        = "os-dynamo-transform-access"
  type        = "data"
  description = "Data access policy for os-dynamo-transform collection"
  policy = jsonencode([
    {
      Rules = [
        {
          Resource     = ["collection/os-dynamo-transform"]
          Permission   = ["aoss:CreateCollectionItems", "aoss:DeleteCollectionItems", "aoss:UpdateCollectionItems", "aoss:DescribeCollectionItems"]
          ResourceType = "collection"
        },
        {
          Resource     = ["index/os-dynamo-transform/*"]
          Permission   = ["aoss:CreateIndex", "aoss:DeleteIndex", "aoss:UpdateIndex", "aoss:DescribeIndex", "aoss:ReadDocument", "aoss:WriteDocument"]
          ResourceType = "index"
        }
      ]
      Principal = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root",
        aws_iam_role.lambda.arn,
      ]
    }
  ])
}
