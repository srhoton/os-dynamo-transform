# os-dynamo-transform

A proof-of-concept change-data-capture pipeline that mirrors Amazon DynamoDB
items into Amazon OpenSearch Serverless in near real time, and demonstrates
**two different ways** to serve the query *"give me an invoice and all of its
work orders"* through a clean, name-abstracted interface.

Every change to the `invoice` and `work_order` DynamoDB tables flows through
DynamoDB Streams → EventBridge Pipes → a custom EventBridge bus → a rule → a
TypeScript Lambda, which writes the change into **both** query substrates:

- **Option 1 — Aliases:** flat per-table indexes exposed through index aliases,
  including a unified `transactions` alias that searches both at once.
- **Option 2 — Nested combined index:** a single `invoice-combined` index where
  each invoice document embeds its work orders as a nested array.

Both are deployed by a single `terraform apply` and can be demoed side by side.

---

## Architecture

```
 ┌──────────────────┐  stream   ┌──────────────────────────────┐
 │ DynamoDB          │─────────▶│ Pipe: os-dynamo-transform-    │──┐
 │ table: invoice    │          │       invoice                │  │
 └──────────────────┘          └──────────────────────────────┘  │
                                                                  ▼
 ┌──────────────────┐  stream   ┌──────────────────────────────┐ ┌──────────────────────────┐
 │ DynamoDB          │─────────▶│ Pipe: os-dynamo-transform-    │▶│ EventBridge bus:         │
 │ table: work_order │          │       work-order             │ │ os-dynamo-transform-bus  │
 └──────────────────┘          └──────────────────────────────┘ └────────────┬─────────────┘
                                                                              │ rule: …-to-lambda
                                                                              ▼
                                                       ┌─────────────────────────────────────┐
                                                       │ Lambda: …-stream-processor            │
                                                       │  handler.ts → applies each record     │
                                                       │  to BOTH substrates                   │
                                                       └──────────┬────────────────┬───────────┘
                                                                  │                │
                       Option 1 (flat + aliases)  ◀───────────────┘                └──────────▶  Option 2 (nested)
            invoice-index / work_order-index                                    invoice-combined
            aliases: invoice, work_order, transactions                          (work_orders nested array)

   Deploy-time only:
   ┌──────────────────────────────────────────────────────────────┐
   │ Lambda: …-bootstrap (invoked once by Terraform on apply)       │
   │  creates indexes + keyword/nested mappings + aliases (idempotent) │
   └──────────────────────────────────────────────────────────────┘

   Everything lives in OpenSearch Serverless collection
   os-dynamo-transform  (region us-west-2)
```

## Components

| Resource | Name |
|---|---|
| DynamoDB table (invoices) | `invoice` — PK `invoice_id` |
| DynamoDB table (work orders) | `work_order` — PK `work_order_id`, FK `invoice_id` |
| EventBridge Pipes | `os-dynamo-transform-invoice`, `os-dynamo-transform-work-order` |
| EventBridge bus | `os-dynamo-transform-bus` |
| EventBridge rule | `os-dynamo-transform-to-lambda` |
| Stream processor Lambda | `os-dynamo-transform-stream-processor` (`handler.handler`) |
| Bootstrap Lambda | `os-dynamo-transform-bootstrap` (`bootstrap.handler`) |
| OpenSearch Serverless collection | `os-dynamo-transform` (type `SEARCH`) |
| Flat indexes (Option 1) | `invoice-index`, `work_order-index` |
| Aliases (Option 1) | `invoice`, `work_order`, `transactions` |
| Combined index (Option 2) | `invoice-combined` |

Infrastructure lives in [`terraform/`](terraform/); the Lambda code in
[`stream_lambda/`](stream_lambda/) (see
[stream_lambda/README.md](stream_lambda/README.md) for code internals).

---

## The two solutions

### Option 1 — Aliases (flat, real-time)

Each table is mirrored 1:1 into its own index (`<table>-index`) with the
DynamoDB primary key as the OpenSearch `_id`. Index **aliases** abstract the
physical names, and a single **unified alias** `transactions` points at *both*
indexes. Because both `invoice` and `work_order` documents carry an `invoice_id`
field (mapped as `keyword`), one query against `transactions` returns the
invoice **and** all of its work orders.

**Query** — an invoice with all its work orders:

```jsonc
GET transactions/_search
{ "query": { "term": { "invoice_id": "inv-100" } } }
```

**Expected result** — flat hits (one invoice + N work orders):

```jsonc
{
  "hits": {
    "total": { "value": 3 },
    "hits": [
      { "_index": "work_order-index", "_id": "wo-100",
        "_source": { "work_order_id": "wo-100", "invoice_id": "inv-100", "description": "Diagnose HVAC", "hours": 3 } },
      { "_index": "invoice-index", "_id": "inv-100",
        "_source": { "invoice_id": "inv-100", "amount": 5000, "customer": "Initech", "status": "open" } },
      { "_index": "work_order-index", "_id": "wo-101",
        "_source": { "work_order_id": "wo-101", "invoice_id": "inv-100", "description": "Replace compressor", "hours": 6 } }
    ]
  }
}
```

You can also query each side independently via its alias: `GET invoice/_search`,
`GET work_order/_search`.

### Option 2 — Nested combined index

A single `invoice-combined` index holds one document per invoice
(`_id = invoice_id`) with its work orders embedded as a `work_orders` **nested**
array. The stream Lambda maintains it server-side via the `_update` API
(Painless `scripted_upsert` for work orders, `doc_as_upsert` for invoice fields),
so the document is mutated atomically and order-independently.

**Query** — the whole invoice + work orders as one document:

```jsonc
GET invoice-combined/_doc/inv-100
```

**Expected result** — a single hierarchical document:

```jsonc
{
  "_index": "invoice-combined",
  "_id": "inv-100",
  "_source": {
    "invoice_id": "inv-100",
    "amount": 5000,
    "customer": "Initech",
    "status": "open",
    "work_orders": [
      { "work_order_id": "wo-100", "invoice_id": "inv-100", "description": "Diagnose HVAC", "hours": 3 },
      { "work_order_id": "wo-101", "invoice_id": "inv-100", "description": "Replace compressor", "hours": 6 }
    ]
  }
}
```

Because `work_orders` is a `nested` type, you can also filter on individual work
orders with a `nested` query against `invoice-combined`.

### Which to use

| | Option 1 — Aliases | Option 2 — Nested combined |
|---|---|---|
| Response shape | flat hits (invoice + work-order docs) | one hierarchical document |
| Query | `term` on the `transactions` alias | `GET` by `invoice_id` (or `nested` query) |
| Write path | simple 1:1 upsert/delete per record | server-side scripted `_update` (read-free) |
| Freshness | ~10 s (one refresh) | ~10 s (one refresh) |
| Ingest complexity | low | higher (scripted merge of the array) |
| Best when | ad-hoc search across both sources | you need the invoice + its work orders as a unit |

### Why not a "continuous transform" or a parent-child join?

OpenSearch **Serverless** does **not** support Index Transforms / ISM, **nor
custom routing** — and a parent-child `join` field requires routing to co-locate
parent and child on one shard. Aliases, nested fields, and server-side scripted
`_update` *are* supported, so the two options above are the viable ways to serve
the query on a Serverless collection.

---

## Deploy

**Prerequisites**

- Terraform ≥ 1.5
- Node.js 20 + npm (the apply step builds the Lambdas locally)
- AWS SSO profile `fb-sandbox-non-prod/Admin`, region `us-west-2`

```bash
aws sso login --profile fb-sandbox-non-prod/Admin

cd terraform
terraform init
AWS_PROFILE=fb-sandbox-non-prod/Admin terraform apply
```

A single `apply`:

1. builds the Lambda bundle (`npm ci && npm run build` → `dist/handler.js`, `dist/bootstrap.js`),
2. deploys the DynamoDB tables, pipes, bus, rule, and both Lambdas,
3. runs the **bootstrap** Lambda, which creates the indexes (with `keyword`/`nested`
   mappings) and the aliases.

Useful outputs:

```bash
terraform output -raw opensearch_collection_endpoint   # https://<id>.us-west-2.aoss.amazonaws.com
terraform output unified_alias                          # "transactions"
terraform output combined_index                         # "invoice-combined"
terraform output -raw opensearch_dashboard_endpoint     # Dashboards URL
```

---

## Trigger (seed data)

Write items to DynamoDB; the change flows through to OpenSearch automatically.
This example creates one invoice and two work orders that reference it:

```bash
export AWS_PROFILE=fb-sandbox-non-prod/Admin AWS_REGION=us-west-2

aws dynamodb put-item --table-name invoice --item \
  '{"invoice_id":{"S":"inv-100"},"amount":{"N":"5000"},"customer":{"S":"Initech"},"status":{"S":"open"}}'

aws dynamodb put-item --table-name work_order --item \
  '{"work_order_id":{"S":"wo-100"},"invoice_id":{"S":"inv-100"},"description":{"S":"Diagnose HVAC"},"hours":{"N":"3"}}'

aws dynamodb put-item --table-name work_order --item \
  '{"work_order_id":{"S":"wo-101"},"invoice_id":{"S":"inv-100"},"description":{"S":"Replace compressor"},"hours":{"N":"6"}}'
```

> **Gotchas when testing**
> - DynamoDB Streams **de-duplicates identical writes** — re-`put-item` with the
>   *exact same* values produces no stream record. Change a field (e.g. bump
>   `amount`) to force a fresh event.
> - The pipes use `starting_position = LATEST`, so only writes made **after** the
>   pipe is running are captured.
> - Reads lag writes by the ~10 s OpenSearch refresh interval — wait a few
>   seconds before querying.

---

## Test (query OpenSearch)

OpenSearch Serverless data-plane requests must be **SigV4-signed** with service
`aoss`. Get the endpoint first:

```bash
export AWS_PROFILE=fb-sandbox-non-prod/Admin AWS_REGION=us-west-2
export OPENSEARCH_ENDPOINT="$(terraform -chdir=terraform output -raw opensearch_collection_endpoint)"
```

### Option A — Node (uses the client already in `stream_lambda/`)

Run from `stream_lambda/` so the dependencies resolve:

```bash
cd stream_lambda && npm ci   # if not already installed
node --input-type=module -e '
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";

const client = new Client({
  ...AwsSigv4Signer({ region: "us-west-2", service: "aoss", getCredentials: () => defaultProvider()() }),
  node: process.env.OPENSEARCH_ENDPOINT,
});

// Option 1: unified alias search
const s = await client.search({ index: "transactions", body: { query: { term: { invoice_id: "inv-100" } } } });
console.log("Option 1 hits:", s.body.hits.hits.map(h => `${h._index}/${h._id}`));

// Option 2: combined document
const d = await client.get({ index: "invoice-combined", id: "inv-100" });
console.log("Option 2 work_orders:", d.body._source.work_orders.map(w => w.work_order_id));
'
```

### Option B — awscurl

```bash
# Install once: pipx install awscurl   (or pip install awscurl)

# Option 1 — unified alias search
awscurl --service aoss --region us-west-2 -X POST \
  "$OPENSEARCH_ENDPOINT/transactions/_search" \
  -H 'Content-Type: application/json' \
  -d '{"query":{"term":{"invoice_id":"inv-100"}}}'

# Option 2 — combined document
awscurl --service aoss --region us-west-2 \
  "$OPENSEARCH_ENDPOINT/invoice-combined/_doc/inv-100"

# Inspect which indexes the unified alias spans
awscurl --service aoss --region us-west-2 "$OPENSEARCH_ENDPOINT/_alias/transactions"
```

### Option C — OpenSearch Dashboards

Open `terraform output -raw opensearch_dashboard_endpoint` and use **Dev Tools**:

```
GET transactions/_search
{ "query": { "term": { "invoice_id": "inv-100" } } }

GET invoice-combined/_doc/inv-100
```

### Delete / prune test

Deleting a work order removes it from **both** substrates:

```bash
aws dynamodb delete-item --table-name work_order --key '{"work_order_id":{"S":"wo-101"}}'
# wait ~10s, then re-run the queries:
#   Option 1: GET transactions {term invoice_id:inv-100}  -> wo-101 no longer in the hits
#   Option 2: GET invoice-combined/_doc/inv-100           -> work_orders array no longer contains wo-101
```

---

## Notes & limitations

- **Refresh latency:** Serverless refreshes roughly every 10 s; a just-written
  record may take a few seconds to appear in queries.
- **Exact-match fields:** `invoice_id` / `work_order_id` are mapped as `keyword`
  so `term` queries match exactly. (Dynamic mapping would analyze them as `text`
  and tokenize values like `inv-100`.)
- **Stream position:** `LATEST` — pre-deploy data is not backfilled.
- **Combined-index consistency:** under heavy bursts the scripted `_update` path
  relies on `retry_on_conflict`; the design is eventually consistent and fine for
  a POC.

## Local development & tests

The Lambda code (TypeScript, strict) lives in [`stream_lambda/`](stream_lambda/):

```bash
cd stream_lambda
npm ci
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest (25 tests)
npm run build       # esbuild -> dist/{handler,bootstrap}.js
```

## Teardown

```bash
cd terraform
AWS_PROFILE=fb-sandbox-non-prod/Admin terraform destroy
```
