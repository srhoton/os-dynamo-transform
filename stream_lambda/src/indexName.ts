/**
 * Extracts the DynamoDB table name from a stream's `eventSourceARN`.
 *
 * A DynamoDB stream ARN has the shape:
 *   arn:aws:dynamodb:<region>:<account>:table/<table>/stream/<label>
 *
 * @param eventSourceARN The `eventSourceARN` from a DynamoDB stream record.
 * @returns The source table name (e.g. `invoice`).
 * @throws {Error} If the ARN does not contain a parseable table name.
 */
export function tableNameFromArn(eventSourceARN: string | undefined): string {
  if (eventSourceARN === undefined || eventSourceARN.length === 0) {
    throw new Error("eventSourceARN is missing; cannot derive table name");
  }

  const match = /:table\/([^/]+)\/stream\//.exec(eventSourceARN);
  if (match === null || match[1] === undefined) {
    throw new Error(`Unable to parse table name from eventSourceARN: ${eventSourceARN}`);
  }

  return match[1];
}

/**
 * Derives the flat OpenSearch index name from a DynamoDB stream's
 * `eventSourceARN`. The index name is the table name suffixed with `-index`,
 * e.g. the `invoice` table maps to the `invoice-index` index.
 *
 * @param eventSourceARN The `eventSourceARN` from a DynamoDB stream record.
 * @returns The target OpenSearch index name (e.g. `invoice-index`).
 * @throws {Error} If the ARN does not contain a parseable table name.
 */
export function indexNameFromArn(eventSourceARN: string | undefined): string {
  return `${tableNameFromArn(eventSourceARN)}-index`;
}
