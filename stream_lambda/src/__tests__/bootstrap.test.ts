import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const updateAliases = vi.fn();
const fakeClient = { indices: { create, updateAliases } };

vi.mock("../opensearchClient", () => ({
  getClient: (): unknown => fakeClient,
}));

import { handler } from "../bootstrap";

describe("bootstrap handler", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ statusCode: 200 });
    updateAliases.mockReset().mockResolvedValue({ statusCode: 200 });
  });

  it("creates the flat indexes, the combined index with a nested mapping, and the aliases", async () => {
    const result = await handler();

    const createdIndexes = create.mock.calls.map((c) => c[0].index);
    expect(createdIndexes).toEqual(["invoice-index", "work_order-index", "invoice-combined"]);

    const flatCall = create.mock.calls.find((c) => c[0].index === "invoice-index");
    expect(flatCall?.[0].body.mappings.properties.invoice_id).toEqual({ type: "keyword" });

    const combinedCall = create.mock.calls.find((c) => c[0].index === "invoice-combined");
    expect(combinedCall?.[0].body.mappings.properties.work_orders.type).toBe("nested");
    expect(combinedCall?.[0].body.mappings.properties.invoice_id).toEqual({ type: "keyword" });

    expect(updateAliases).toHaveBeenCalledTimes(1);
    const aliasCall = updateAliases.mock.calls[0];
    expect(aliasCall).toBeDefined();
    const actions = aliasCall?.[0].body.actions;
    expect(actions).toEqual([
      { add: { index: "invoice-index", alias: "invoice" } },
      { add: { index: "work_order-index", alias: "work_order" } },
      { add: { indices: ["invoice-index", "work_order-index"], alias: "transactions" } },
    ]);

    expect(result.aliases).toEqual(["invoice", "work_order", "transactions"]);
  });

  it("treats an already-existing index (400) as success", async () => {
    create.mockReset().mockRejectedValue({ statusCode: 400 });
    await expect(handler()).resolves.toMatchObject({ ok: true });
    expect(updateAliases).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-400 create failure", async () => {
    create.mockReset().mockRejectedValue({ statusCode: 500 });
    await expect(handler()).rejects.toMatchObject({ statusCode: 500 });
  });
});
