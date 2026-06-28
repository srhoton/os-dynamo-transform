import type { Client } from "@opensearch-project/opensearch";

import { isNotFound, type StreamRecord } from "./record";

/**
 * Option 1 writer. Mirrors a DynamoDB change into the flat per-table index
 * (`<table>-index`): INSERT/MODIFY upsert the new image (PK as `_id`), REMOVE
 * deletes the document. A 404 on delete is treated as success.
 *
 * @param client The OpenSearch client.
 * @param record The normalized stream record.
 */
export async function applyToFlatIndex(client: Client, record: StreamRecord): Promise<void> {
  const { flatIndex: index, id, eventName } = record;

  if (eventName === "INSERT" || eventName === "MODIFY") {
    if (record.newImage === undefined) {
      throw new Error(`${eventName} record for ${index}/${id} has no NewImage`);
    }
    await client.index({ index, id, body: record.newImage });
    console.info(JSON.stringify({ msg: "flat-indexed", index, id, eventName }));
    return;
  }

  if (eventName === "REMOVE") {
    try {
      await client.delete({ index, id });
      console.info(JSON.stringify({ msg: "flat-deleted", index, id }));
    } catch (err: unknown) {
      if (isNotFound(err)) {
        console.info(JSON.stringify({ msg: "flat-delete-skipped-404", index, id }));
        return;
      }
      throw err;
    }
    return;
  }

  console.warn(JSON.stringify({ msg: "flat-unhandled-event", index, id, eventName }));
}
