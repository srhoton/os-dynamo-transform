# stream_lambda

TypeScript Lambda that mirrors DynamoDB change events into OpenSearch Serverless.

## Flow

DynamoDB stream → EventBridge Pipe → EventBridge bus → rule → **this Lambda** → OpenSearch index.

Each DynamoDB stream record arrives in the EventBridge event's `detail`. The
handler derives the target index from the record's `eventSourceARN`
(`<table>` → `<table>-index`, e.g. `invoice` → `invoice-index`) and:

- **INSERT / MODIFY** — indexes the unmarshalled `NewImage`, using the DynamoDB
  primary key value as the OpenSearch `_id` (so modifies upsert in place).
- **REMOVE** — deletes the document by `_id` (a 404 is treated as success).

## Build & deploy

The Terraform in `../terraform` builds and deploys this Lambda automatically on
`terraform apply` (a `null_resource` runs `npm ci && npm run build`, then the
`dist/` bundle is zipped and deployed). **Node.js 20 and npm must be available
on the machine running `terraform apply`.**

## Local development

```bash
npm ci
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest
npm run build       # esbuild bundle -> dist/handler.js
```

## Environment

| Variable | Description |
|---|---|
| `OPENSEARCH_ENDPOINT` | HTTPS endpoint of the OpenSearch Serverless collection |
| `AWS_REGION` | Injected by the Lambda runtime; used for SigV4 signing (`aoss`) |
