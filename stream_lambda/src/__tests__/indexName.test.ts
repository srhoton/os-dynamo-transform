import { describe, expect, it } from "vitest";

import { indexNameFromArn } from "../indexName";

describe("indexNameFromArn", () => {
  it("derives <table>-index from an invoice stream ARN", () => {
    const arn =
      "arn:aws:dynamodb:us-west-2:345594586248:table/invoice/stream/2026-06-27T17:32:41.384";
    expect(indexNameFromArn(arn)).toBe("invoice-index");
  });

  it("derives <table>-index from a work_order stream ARN", () => {
    const arn =
      "arn:aws:dynamodb:us-west-2:345594586248:table/work_order/stream/2026-06-27T17:32:41.369";
    expect(indexNameFromArn(arn)).toBe("work_order-index");
  });

  it("throws when the ARN is undefined", () => {
    expect(() => indexNameFromArn(undefined)).toThrow(/missing/);
  });

  it("throws when the ARN has no parseable table name", () => {
    expect(() => indexNameFromArn("arn:aws:dynamodb:us-west-2:123:not-a-table")).toThrow(
      /Unable to parse/,
    );
  });
});
