import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMBINED_INDEX } from "../aliases";
import { applyToCombinedIndex } from "../combinedIndex";
import type { StreamRecord } from "../record";

const update = vi.fn();
const del = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = { update, delete: del } as any;

function invoiceRec(p: Partial<StreamRecord>): StreamRecord {
  return {
    table: "invoice",
    flatIndex: "invoice-index",
    eventName: "INSERT",
    id: "inv-1",
    keys: { invoice_id: "inv-1" },
    newImage: { invoice_id: "inv-1", amount: 100 },
    oldImage: undefined,
    ...p,
  };
}

function workOrderRec(p: Partial<StreamRecord>): StreamRecord {
  return {
    table: "work_order",
    flatIndex: "work_order-index",
    eventName: "INSERT",
    id: "wo-1",
    keys: { work_order_id: "wo-1" },
    newImage: { work_order_id: "wo-1", invoice_id: "inv-1", hours: 4 },
    oldImage: undefined,
    ...p,
  };
}

describe("applyToCombinedIndex - invoice", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ statusCode: 200 });
    del.mockReset().mockResolvedValue({ statusCode: 200 });
  });

  it("upserts invoice fields via partial doc, preserving work_orders", async () => {
    await applyToCombinedIndex(client, invoiceRec({ eventName: "MODIFY" }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        index: COMBINED_INDEX,
        id: "inv-1",
        body: { doc: { invoice_id: "inv-1", amount: 100 }, doc_as_upsert: true },
      }),
    );
  });

  it("deletes the combined doc on REMOVE", async () => {
    await applyToCombinedIndex(client, invoiceRec({ eventName: "REMOVE", newImage: undefined }));
    expect(del).toHaveBeenCalledWith({ index: COMBINED_INDEX, id: "inv-1" });
  });

  it("swallows 404 on invoice REMOVE", async () => {
    del.mockRejectedValueOnce({ statusCode: 404 });
    await expect(
      applyToCombinedIndex(client, invoiceRec({ eventName: "REMOVE", newImage: undefined })),
    ).resolves.toBeUndefined();
  });
});

describe("applyToCombinedIndex - work_order", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ statusCode: 200 });
    del.mockReset().mockResolvedValue({ statusCode: 200 });
  });

  it("adds the work order via a scripted upsert keyed by invoice_id", async () => {
    await applyToCombinedIndex(client, workOrderRec({}));
    const call = update.mock.calls[0]?.[0];
    expect(call.index).toBe(COMBINED_INDEX);
    expect(call.id).toBe("inv-1");
    expect(call.body.scripted_upsert).toBe(true);
    expect(call.body.script.params.wo).toEqual({
      work_order_id: "wo-1",
      invoice_id: "inv-1",
      hours: 4,
    });
    expect(call.body.script.source).toContain(".add(params.wo)");
  });

  it("prunes the work order via a scripted update on REMOVE (OldImage parent)", async () => {
    await applyToCombinedIndex(
      client,
      workOrderRec({
        eventName: "REMOVE",
        newImage: undefined,
        oldImage: { work_order_id: "wo-1", invoice_id: "inv-1" },
      }),
    );
    const call = update.mock.calls[0]?.[0];
    expect(call.id).toBe("inv-1");
    expect(call.body.script.params.woId).toBe("wo-1");
    expect(call.body.script.source).toContain("removeIf");
    expect(call.body.scripted_upsert).toBeUndefined();
  });

  it("swallows 404 when pruning from a missing parent", async () => {
    update.mockRejectedValueOnce({ statusCode: 404 });
    await expect(
      applyToCombinedIndex(
        client,
        workOrderRec({
          eventName: "REMOVE",
          newImage: undefined,
          oldImage: { work_order_id: "wo-1", invoice_id: "inv-1" },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("skips when the work_order has no invoice_id", async () => {
    await applyToCombinedIndex(
      client,
      workOrderRec({ newImage: { work_order_id: "wo-1", hours: 4 } }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});
