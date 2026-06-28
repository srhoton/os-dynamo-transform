import { describe, expect, it } from "vitest";

import { indexNameFromArn, tableNameFromArn } from "../indexName";

const ARN_INVOICE =
  "arn:aws:dynamodb:us-west-2:345594586248:table/invoice/stream/2026-06-27T17:32:41.384";
const ARN_WORK_ORDER =
  "arn:aws:dynamodb:us-west-2:345594586248:table/work_order/stream/2026-06-27T17:32:41.369";

describe("tableNameFromArn", () => {
  it("extracts the table name", () => {
    expect(tableNameFromArn(ARN_INVOICE)).toBe("invoice");
    expect(tableNameFromArn(ARN_WORK_ORDER)).toBe("work_order");
  });

  it("throws when undefined", () => {
    expect(() => tableNameFromArn(undefined)).toThrow(/missing/);
  });

  it("throws when unparseable", () => {
    expect(() => tableNameFromArn("arn:aws:dynamodb:us-west-2:123:not-a-table")).toThrow(
      /Unable to parse/,
    );
  });
});

describe("indexNameFromArn", () => {
  it("derives <table>-index", () => {
    expect(indexNameFromArn(ARN_INVOICE)).toBe("invoice-index");
    expect(indexNameFromArn(ARN_WORK_ORDER)).toBe("work_order-index");
  });
});
