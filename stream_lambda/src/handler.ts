import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import type { Client } from "@opensearch-project/opensearch";
import type { EventBridgeEvent } from "aws-lambda";

import { indexNameFromArn } from "./indexName";
import { getClient } from "./opensearchClient";

/** Marshalled DynamoDB image as it appears in a stream record. */
type MarshalledImage = Record<string, AttributeValue>;

/** The DynamoDB stream record carried in an EventBridge event's `detail`. */
interface DynamoStreamDetail {
  eventName?: "INSERT" | "MODIFY" | "REMOVE";
  eventSourceARN?: string;
  dynamodb?: {
    Keys?: MarshalledImage;
    NewImage?: MarshalledImage;
    OldImage?: MarshalledImage;
  };
}

/**
 * EventBridge event whose `detail` is a single DynamoDB stream record. An
 * EventBridge Pipe with an event-bus target places one record per event, but
 * the handler also tolerates a `detail` that is an array of records.
 */
type StreamEvent = EventBridgeEvent<string, DynamoStreamDetail | DynamoStreamDetail[]>;

/**
 * Computes a stable OpenSearch document id from a record's DynamoDB `Keys`.
 *
 * The unmarshalled key values are sorted by attribute name and joined with
 * `#`, yielding a deterministic id for both single and composite keys.
 *
 * @param keys The marshalled `Keys` map from the stream record.
 * @returns A document id string.
 * @throws {Error} If the record carries no keys.
 */
function documentId(keys: MarshalledImage | undefined): string {
  if (keys === undefined || Object.keys(keys).length === 0) {
    throw new Error("Stream record is missing dynamodb.Keys; cannot derive document id");
  }

  const plain = unmarshall(keys);
  return Object.keys(plain)
    .sort()
    .map((name) => String(plain[name]))
    .join("#");
}

/**
 * Applies a single DynamoDB stream record to OpenSearch: INSERT and MODIFY
 * upsert the new image, REMOVE deletes the document. A 404 on delete is
 * treated as success (the document was already absent).
 *
 * @param client The OpenSearch client.
 * @param record One DynamoDB stream record from an EventBridge event detail.
 */
async function processRecord(client: Client, record: DynamoStreamDetail): Promise<void> {
  const index = indexNameFromArn(record.eventSourceARN);
  const id = documentId(record.dynamodb?.Keys);
  const eventName = record.eventName;

  if (eventName === "INSERT" || eventName === "MODIFY") {
    const image = record.dynamodb?.NewImage;
    if (image === undefined) {
      throw new Error(`${eventName} record for ${index}/${id} has no NewImage`);
    }
    await client.index({ index, id, body: unmarshall(image) });
    console.info(JSON.stringify({ msg: "indexed", index, id, eventName }));
    return;
  }

  if (eventName === "REMOVE") {
    try {
      await client.delete({ index, id });
      console.info(JSON.stringify({ msg: "deleted", index, id }));
    } catch (err: unknown) {
      if (isNotFound(err)) {
        console.info(JSON.stringify({ msg: "delete-skipped-404", index, id }));
        return;
      }
      throw err;
    }
    return;
  }

  console.warn(JSON.stringify({ msg: "unhandled-event-name", index, id, eventName }));
}

/** Returns true when an OpenSearch error represents a 404 Not Found. */
function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "statusCode" in err
    ? (err as { statusCode?: number }).statusCode === 404
    : false;
}

/**
 * Lambda entrypoint. Receives DynamoDB stream records routed through an
 * EventBridge bus and mirrors each change into the matching OpenSearch index
 * (`<table>-index`). Throws on failure so EventBridge retries the delivery.
 *
 * @param event The EventBridge event (or batch) carrying stream record(s).
 */
export async function handler(event: StreamEvent): Promise<void> {
  const detail = event.detail;
  const records = Array.isArray(detail) ? detail : [detail];
  const client = getClient();

  for (const record of records) {
    await processRecord(client, record);
  }
}
