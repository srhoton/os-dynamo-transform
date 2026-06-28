import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import { indexNameFromArn, tableNameFromArn } from "./indexName";

/** Marshalled DynamoDB image as it appears in a stream record. */
export type MarshalledImage = Record<string, AttributeValue>;

/** Plain (unmarshalled) document. */
export type PlainDocument = Record<string, unknown>;

/** The DynamoDB stream record carried in an EventBridge event's `detail`. */
export interface DynamoStreamDetail {
  eventName?: "INSERT" | "MODIFY" | "REMOVE";
  eventSourceARN?: string;
  dynamodb?: {
    Keys?: MarshalledImage;
    NewImage?: MarshalledImage;
    OldImage?: MarshalledImage;
  };
}

/** A normalized, unmarshalled view of a DynamoDB stream record. */
export interface StreamRecord {
  /** Source table name, e.g. `invoice`. */
  table: string;
  /** Flat per-table index name, e.g. `invoice-index`. */
  flatIndex: string;
  /** DynamoDB change type. */
  eventName: "INSERT" | "MODIFY" | "REMOVE" | undefined;
  /** Document id derived from the primary key. */
  id: string;
  /** Unmarshalled primary key. */
  keys: PlainDocument;
  /** Unmarshalled new image (INSERT/MODIFY), if present. */
  newImage: PlainDocument | undefined;
  /** Unmarshalled old image (MODIFY/REMOVE with NEW_AND_OLD_IMAGES), if present. */
  oldImage: PlainDocument | undefined;
}

/**
 * Computes a stable document id from a record's DynamoDB `Keys`. The
 * unmarshalled key values are sorted by attribute name and joined with `#`,
 * yielding a deterministic id for both single and composite keys.
 */
function documentId(keys: PlainDocument): string {
  return Object.keys(keys)
    .sort()
    .map((name) => String(keys[name]))
    .join("#");
}

/**
 * Normalizes a raw EventBridge `detail` (a DynamoDB stream record) into a
 * {@link StreamRecord} with unmarshalled images and derived names.
 *
 * @param detail One DynamoDB stream record from an EventBridge event detail.
 * @returns The normalized record.
 * @throws {Error} If the record is missing keys or an unparseable ARN.
 */
export function parseRecord(detail: DynamoStreamDetail): StreamRecord {
  const rawKeys = detail.dynamodb?.Keys;
  if (rawKeys === undefined || Object.keys(rawKeys).length === 0) {
    throw new Error("Stream record is missing dynamodb.Keys; cannot derive document id");
  }

  const keys = unmarshall(rawKeys);
  const newImageRaw = detail.dynamodb?.NewImage;
  const oldImageRaw = detail.dynamodb?.OldImage;

  return {
    table: tableNameFromArn(detail.eventSourceARN),
    flatIndex: indexNameFromArn(detail.eventSourceARN),
    eventName: detail.eventName,
    id: documentId(keys),
    keys,
    newImage: newImageRaw === undefined ? undefined : unmarshall(newImageRaw),
    oldImage: oldImageRaw === undefined ? undefined : unmarshall(oldImageRaw),
  };
}

/** Returns true when an OpenSearch error represents a 404 Not Found. */
export function isNotFound(err: unknown): boolean {
  return statusCodeOf(err) === 404;
}

/** Returns true when an OpenSearch error represents a 409 version conflict. */
export function isConflict(err: unknown): boolean {
  return statusCodeOf(err) === 409;
}

/** Extracts an HTTP status code from an OpenSearch client error, if present. */
export function statusCodeOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "statusCode" in err
    ? (err as { statusCode?: number }).statusCode
    : undefined;
}
