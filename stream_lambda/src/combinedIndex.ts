import type { Client } from "@opensearch-project/opensearch";

import { COMBINED_INDEX, WORK_ORDERS_FIELD } from "./aliases";
import { isNotFound, type StreamRecord } from "./record";

const INVOICE_TABLE = "invoice";
const WORK_ORDER_TABLE = "work_order";
const INVOICE_FK = "invoice_id";

/** Server-side retries when concurrent script updates touch the same doc. */
const RETRY_ON_CONFLICT = 5;

// Inserts/replaces a work order in the parent invoice's nested array. Runs
// server-side so it mutates the live document version — no client-side
// read-modify-write, which is unsafe on Serverless (GET is not real-time).
const ADD_WORK_ORDER_SCRIPT = [
  `if (ctx._source.${WORK_ORDERS_FIELD} == null) { ctx._source.${WORK_ORDERS_FIELD} = []; }`,
  `ctx._source.${WORK_ORDERS_FIELD}.removeIf(w -> w.work_order_id == params.wo.work_order_id);`,
  `ctx._source.${WORK_ORDERS_FIELD}.add(params.wo);`,
  `ctx._source.${INVOICE_FK} = params.parent;`,
].join(" ");

// Removes a work order from the parent invoice's nested array.
const REMOVE_WORK_ORDER_SCRIPT = [
  `if (ctx._source.${WORK_ORDERS_FIELD} != null) {`,
  `  ctx._source.${WORK_ORDERS_FIELD}.removeIf(w -> w.work_order_id == params.woId);`,
  `}`,
].join(" ");

/**
 * Option 2 writer. Maintains the denormalized `invoice-combined` index where
 * each invoice document carries a nested `work_orders` array. All mutations use
 * the server-side `_update` API (partial doc upsert for invoices, Painless
 * scripted upsert for work orders) so they are atomic against the live document
 * version — avoiding the non-real-time-GET races inherent to OpenSearch
 * Serverless.
 *
 * @param client The OpenSearch client.
 * @param record The normalized stream record.
 */
export async function applyToCombinedIndex(client: Client, record: StreamRecord): Promise<void> {
  if (record.table === INVOICE_TABLE) {
    await applyInvoice(client, record);
    return;
  }
  if (record.table === WORK_ORDER_TABLE) {
    await applyWorkOrder(client, record);
    return;
  }
  console.warn(JSON.stringify({ msg: "combined-skip-unknown-table", table: record.table }));
}

/** Upserts an invoice's own fields, preserving the existing work_orders array. */
async function applyInvoice(client: Client, record: StreamRecord): Promise<void> {
  const id = record.id;

  if (record.eventName === "REMOVE") {
    try {
      await client.delete({ index: COMBINED_INDEX, id });
      console.info(JSON.stringify({ msg: "combined-invoice-deleted", id }));
    } catch (err: unknown) {
      if (!isNotFound(err)) {
        throw err;
      }
    }
    return;
  }

  if (record.newImage === undefined) {
    throw new Error(`${record.eventName} invoice ${id} has no NewImage`);
  }

  // Partial-doc upsert merges invoice fields without touching work_orders.
  await client.update({
    index: COMBINED_INDEX,
    id,
    retry_on_conflict: RETRY_ON_CONFLICT,
    body: { doc: record.newImage, doc_as_upsert: true },
  });
  console.info(JSON.stringify({ msg: "combined-invoice-upserted", id }));
}

/** Adds/replaces/removes a work order in its parent invoice's nested array. */
async function applyWorkOrder(client: Client, record: StreamRecord): Promise<void> {
  const woId = record.id;
  const image = record.eventName === "REMOVE" ? record.oldImage : record.newImage;
  const parent = image?.[INVOICE_FK];

  if (parent === undefined || parent === null || String(parent).length === 0) {
    console.warn(JSON.stringify({ msg: "combined-skip-no-parent", woId, eventName: record.eventName }));
    return;
  }
  const parentId = String(parent);

  if (record.eventName === "REMOVE") {
    try {
      await client.update({
        index: COMBINED_INDEX,
        id: parentId,
        retry_on_conflict: RETRY_ON_CONFLICT,
        body: {
          script: { lang: "painless", source: REMOVE_WORK_ORDER_SCRIPT, params: { woId } },
        },
      });
      console.info(JSON.stringify({ msg: "combined-wo-pruned", parent: parentId, woId }));
    } catch (err: unknown) {
      // Parent document absent: nothing to prune.
      if (!isNotFound(err)) {
        throw err;
      }
    }
    return;
  }

  if (record.newImage === undefined) {
    throw new Error(`${record.eventName} work_order ${woId} has no NewImage`);
  }

  // scripted_upsert builds the parent doc from the script even when it does not
  // yet exist (out-of-order arrival before the invoice).
  await client.update({
    index: COMBINED_INDEX,
    id: parentId,
    retry_on_conflict: RETRY_ON_CONFLICT,
    body: {
      scripted_upsert: true,
      upsert: {},
      script: {
        lang: "painless",
        source: ADD_WORK_ORDER_SCRIPT,
        params: { wo: record.newImage, parent: parentId },
      },
    },
  });
  console.info(JSON.stringify({ msg: "combined-wo-upserted", parent: parentId, woId }));
}
