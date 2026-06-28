import { describe, expect, it } from "vitest";

import { isConflict, isNotFound, parseRecord, statusCodeOf } from "../record";

const ARN = "arn:aws:dynamodb:us-west-2:111:table/invoice/stream/x";

describe("parseRecord", () => {
  it("normalizes table, index, id and unmarshalled images", () => {
    const rec = parseRecord({
      eventName: "MODIFY",
      eventSourceARN: ARN,
      dynamodb: {
        Keys: { invoice_id: { S: "inv-1" } },
        NewImage: { invoice_id: { S: "inv-1" }, amount: { N: "100" } },
        OldImage: { invoice_id: { S: "inv-1" }, amount: { N: "50" } },
      },
    });

    expect(rec.table).toBe("invoice");
    expect(rec.flatIndex).toBe("invoice-index");
    expect(rec.eventName).toBe("MODIFY");
    expect(rec.id).toBe("inv-1");
    expect(rec.newImage).toEqual({ invoice_id: "inv-1", amount: 100 });
    expect(rec.oldImage).toEqual({ invoice_id: "inv-1", amount: 50 });
  });

  it("joins composite keys deterministically", () => {
    const rec = parseRecord({
      eventName: "INSERT",
      eventSourceARN: ARN,
      dynamodb: { Keys: { b: { S: "2" }, a: { S: "1" } }, NewImage: { a: { S: "1" } } },
    });
    expect(rec.id).toBe("1#2");
  });

  it("throws when keys are missing", () => {
    expect(() =>
      parseRecord({ eventName: "INSERT", eventSourceARN: ARN, dynamodb: {} }),
    ).toThrow(/missing dynamodb.Keys/);
  });
});

describe("error predicates", () => {
  it("detects 404 and 409", () => {
    expect(isNotFound({ statusCode: 404 })).toBe(true);
    expect(isNotFound({ statusCode: 409 })).toBe(false);
    expect(isConflict({ statusCode: 409 })).toBe(true);
    expect(statusCodeOf({ statusCode: 400 })).toBe(400);
    expect(statusCodeOf("nope")).toBeUndefined();
  });
});
