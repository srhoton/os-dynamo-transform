# stream_lambda

TypeScript Lambdas that mirror DynamoDB change events into OpenSearch Serverless
and provision the query substrates.

## Flow

DynamoDB stream → EventBridge Pipe → EventBridge bus → rule → **handler Lambda** → OpenSearch.

Each DynamoDB stream record arrives in the EventBridge event's `detail`. The
handler normalizes it (`record.ts`) and applies it to **two** query substrates:

### Option 1 — Aliases (real-time, flat)
- `flatIndex.ts` writes each record to its per-table index (`<table>-index`),
  using the DynamoDB primary key as the OpenSearch `_id` (INSERT/MODIFY upsert,
  REMOVE delete).
- Aliases (created by the bootstrap) abstract the names: `invoice` →
  `invoice-index`, `work_order` → `work_order-index`, and the unified
  `transactions` → both.
- **Query "an invoice and all its work orders"** (both docs carry `invoice_id`):
  ```
  GET transactions/_search { "query": { "term": { "invoice_id": "inv-001" } } }
  ```
  Returns the invoice hit plus every work-order hit, in one call.

### Option 2 — Nested denormalization (combined document)
- `combinedIndex.ts` maintains the `invoice-combined` index, where each invoice
  document (`_id = invoice_id`) carries a `work_orders` **nested array**. Work
  orders are merged into their parent invoice with the server-side `_update`
  API (Painless `scripted_upsert` for work orders, `doc_as_upsert` for invoice
  fields), so mutations are atomic against the live document version.
- **Query "an invoice and all its work orders"** as one hierarchical document:
  ```
  GET invoice-combined/_doc/inv-001
  ```

## Why not a "continuous transform" or parent-child join?

OpenSearch **Serverless** does not support Index Transforms/ISM, **nor custom
routing** — and parent-child `join` fields require routing to co-locate parent
and child on one shard. Aliases and nested fields are supported, so the two
options above are the viable ways to serve the query.

### Option 2 notes (POC)
Serverless has ~10s refresh and no real-time GET, which makes client-side
read-modify-write unsafe. The writer therefore mutates the combined document
**server-side** via `_update` (scripted upsert + `retry_on_conflict`), so it is
atomic per document and order-independent (a work order arriving before its
invoice creates a stub via `scripted_upsert`). Note OpenSearch Serverless does
not support Painless **stored** scripts, but inline update scripts (used here)
are supported. Reads remain subject to the ~10s refresh, so a just-written
record may take a few seconds to appear in queries.

## Bootstrap

`bootstrap.ts` is a second handler in this package, invoked by Terraform on
`apply`. It ensures the flat indexes exist, creates `invoice-combined` with the
nested mapping, and applies the aliases. It is idempotent.

## Build & deploy

`terraform apply` builds and deploys both Lambdas automatically (a
`null_resource` runs `npm ci && npm run build`, producing `dist/handler.js` and
`dist/bootstrap.js`, which are zipped and deployed). **Node.js 20 and npm must
be available on the machine running `terraform apply`.**

## Local development

```bash
npm ci
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest
npm run build       # esbuild bundle -> dist/{handler,bootstrap}.js
```

## Environment

| Variable | Description |
|---|---|
| `OPENSEARCH_ENDPOINT` | HTTPS endpoint of the OpenSearch Serverless collection |
| `AWS_REGION` | Injected by the Lambda runtime; used for SigV4 signing (`aoss`) |
