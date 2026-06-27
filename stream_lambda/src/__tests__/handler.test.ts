import { beforeEach, describe, expect, it, vi } from "vitest";

const index = vi.fn();
const del = vi.fn();
const fakeClient = { index, delete: del };

vi.mock("../opensearchClient", () => ({
  getClient: (): unknown => fakeClient,
}));

// Imported after the mock is registered.
import { handler } from "../handler";

const ARN_INVOICE = "arn:aws:dynamodb:us-west-2:111:table/invoice/stream/x";
const ARN_WORK_ORDER = "arn:aws:dynamodb:us-west-2:111:table/work_order/stream/y";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function event(detail: unknown): any {
  return { detail };
}

describe("handler", () => {
  beforeEach(() => {
    index.mockReset();
    del.mockReset();
    index.mockResolvedValue({ statusCode: 200 });
    del.mockResolvedValue({ statusCode: 200 });
  });

  it("indexes the unmarshalled NewImage on INSERT", async () => {
    await handler(
      event({
        eventName: "INSERT",
        eventSourceARN: ARN_INVOICE,
        dynamodb: {
          Keys: { invoice_id: { S: "inv-1" } },
          NewImage: { invoice_id: { S: "inv-1" }, amount: { N: "100" } },
        },
      }),
    );

    expect(index).toHaveBeenCalledTimes(1);
    expect(index).toHaveBeenCalledWith({
      index: "invoice-index",
      id: "inv-1",
      body: { invoice_id: "inv-1", amount: 100 },
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("upserts on MODIFY", async () => {
    await handler(
      event({
        eventName: "MODIFY",
        eventSourceARN: ARN_WORK_ORDER,
        dynamodb: {
          Keys: { work_order_id: { S: "wo-9" } },
          NewImage: { work_order_id: { S: "wo-9" }, status: { S: "closed" } },
        },
      }),
    );

    expect(index).toHaveBeenCalledWith({
      index: "work_order-index",
      id: "wo-9",
      body: { work_order_id: "wo-9", status: "closed" },
    });
  });

  it("deletes the document on REMOVE", async () => {
    await handler(
      event({
        eventName: "REMOVE",
        eventSourceARN: ARN_WORK_ORDER,
        dynamodb: { Keys: { work_order_id: { S: "wo-9" } } },
      }),
    );

    expect(del).toHaveBeenCalledWith({ index: "work_order-index", id: "wo-9" });
    expect(index).not.toHaveBeenCalled();
  });

  it("swallows a 404 on REMOVE", async () => {
    del.mockRejectedValueOnce({ statusCode: 404 });
    await expect(
      handler(
        event({
          eventName: "REMOVE",
          eventSourceARN: ARN_INVOICE,
          dynamodb: { Keys: { invoice_id: { S: "gone" } } },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("rethrows a non-404 error on REMOVE", async () => {
    del.mockRejectedValueOnce({ statusCode: 500 });
    await expect(
      handler(
        event({
          eventName: "REMOVE",
          eventSourceARN: ARN_INVOICE,
          dynamodb: { Keys: { invoice_id: { S: "boom" } } },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("processes each record when detail is an array", async () => {
    await handler(
      event([
        {
          eventName: "INSERT",
          eventSourceARN: ARN_INVOICE,
          dynamodb: {
            Keys: { invoice_id: { S: "a" } },
            NewImage: { invoice_id: { S: "a" } },
          },
        },
        {
          eventName: "INSERT",
          eventSourceARN: ARN_WORK_ORDER,
          dynamodb: {
            Keys: { work_order_id: { S: "b" } },
            NewImage: { work_order_id: { S: "b" } },
          },
        },
      ]),
    );

    expect(index).toHaveBeenCalledTimes(2);
  });
});
