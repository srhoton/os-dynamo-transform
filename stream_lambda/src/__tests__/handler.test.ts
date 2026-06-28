import { beforeEach, describe, expect, it, vi } from "vitest";

const { applyToFlatIndex, applyToCombinedIndex } = vi.hoisted(() => ({
  applyToFlatIndex: vi.fn(),
  applyToCombinedIndex: vi.fn(),
}));

vi.mock("../opensearchClient", () => ({ getClient: (): unknown => ({}) }));
vi.mock("../flatIndex", () => ({ applyToFlatIndex }));
vi.mock("../combinedIndex", () => ({ applyToCombinedIndex }));

import { handler } from "../handler";

const ARN = "arn:aws:dynamodb:us-west-2:111:table/invoice/stream/x";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function event(detail: unknown): any {
  return { detail };
}

const sampleDetail = {
  eventName: "INSERT",
  eventSourceARN: ARN,
  dynamodb: { Keys: { invoice_id: { S: "inv-1" } }, NewImage: { invoice_id: { S: "inv-1" } } },
};

describe("handler", () => {
  beforeEach(() => {
    applyToFlatIndex.mockReset().mockResolvedValue(undefined);
    applyToCombinedIndex.mockReset().mockResolvedValue(undefined);
  });

  it("applies each record to both the flat and combined writers", async () => {
    await handler(event(sampleDetail));
    expect(applyToFlatIndex).toHaveBeenCalledTimes(1);
    expect(applyToCombinedIndex).toHaveBeenCalledTimes(1);
    const firstCall = applyToFlatIndex.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[1]).toMatchObject({ id: "inv-1", flatIndex: "invoice-index" });
  });

  it("processes every record when detail is an array", async () => {
    await handler(event([sampleDetail, sampleDetail]));
    expect(applyToFlatIndex).toHaveBeenCalledTimes(2);
    expect(applyToCombinedIndex).toHaveBeenCalledTimes(2);
  });

  it("propagates writer failures so EventBridge retries", async () => {
    applyToCombinedIndex.mockRejectedValueOnce(new Error("boom"));
    await expect(handler(event(sampleDetail))).rejects.toThrow("boom");
  });
});
