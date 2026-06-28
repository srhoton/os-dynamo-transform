import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyToFlatIndex } from "../flatIndex";
import type { StreamRecord } from "../record";

const index = vi.fn();
const del = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = { index, delete: del } as any;

function record(partial: Partial<StreamRecord>): StreamRecord {
  return {
    table: "invoice",
    flatIndex: "invoice-index",
    eventName: "INSERT",
    id: "inv-1",
    keys: { invoice_id: "inv-1" },
    newImage: { invoice_id: "inv-1" },
    oldImage: undefined,
    ...partial,
  };
}

describe("applyToFlatIndex", () => {
  beforeEach(() => {
    index.mockReset().mockResolvedValue({ statusCode: 200 });
    del.mockReset().mockResolvedValue({ statusCode: 200 });
  });

  it("indexes NewImage on INSERT", async () => {
    await applyToFlatIndex(client, record({ newImage: { invoice_id: "inv-1", amount: 100 } }));
    expect(index).toHaveBeenCalledWith({
      index: "invoice-index",
      id: "inv-1",
      body: { invoice_id: "inv-1", amount: 100 },
    });
  });

  it("deletes on REMOVE", async () => {
    await applyToFlatIndex(client, record({ eventName: "REMOVE", newImage: undefined }));
    expect(del).toHaveBeenCalledWith({ index: "invoice-index", id: "inv-1" });
  });

  it("swallows 404 on REMOVE", async () => {
    del.mockRejectedValueOnce({ statusCode: 404 });
    await expect(
      applyToFlatIndex(client, record({ eventName: "REMOVE", newImage: undefined })),
    ).resolves.toBeUndefined();
  });

  it("rethrows non-404 on REMOVE", async () => {
    del.mockRejectedValueOnce({ statusCode: 500 });
    await expect(
      applyToFlatIndex(client, record({ eventName: "REMOVE", newImage: undefined })),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
