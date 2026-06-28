import type { EventBridgeEvent } from "aws-lambda";

import { applyToCombinedIndex } from "./combinedIndex";
import { applyToFlatIndex } from "./flatIndex";
import { getClient } from "./opensearchClient";
import { type DynamoStreamDetail, parseRecord } from "./record";

/**
 * EventBridge event whose `detail` is a single DynamoDB stream record. An
 * EventBridge Pipe with an event-bus target places one record per event, but
 * the handler also tolerates a `detail` that is an array of records.
 */
type StreamEvent = EventBridgeEvent<string, DynamoStreamDetail | DynamoStreamDetail[]>;

/**
 * Lambda entrypoint. Receives DynamoDB stream records routed through an
 * EventBridge bus and applies each change to both query substrates:
 *
 *  - Option 1: the flat per-table index (`<table>-index`), surfaced via aliases.
 *  - Option 2: the denormalized `invoice-combined` index (nested work_orders).
 *
 * Both writes run per record; a failure throws so EventBridge retries delivery.
 * All operations are idempotent/keyed, so retries are safe.
 *
 * @param event The EventBridge event (or batch) carrying stream record(s).
 */
export async function handler(event: StreamEvent): Promise<void> {
  const detail = event.detail;
  const details = Array.isArray(detail) ? detail : [detail];
  const client = getClient();

  for (const raw of details) {
    const record = parseRecord(raw);
    await Promise.all([
      applyToFlatIndex(client, record),
      applyToCombinedIndex(client, record),
    ]);
  }
}
