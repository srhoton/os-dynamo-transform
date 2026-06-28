/** A single `_aliases` add action (supports one index or several). */
export interface AliasAction {
  add: { index?: string; indices?: string[]; alias: string };
}

/** Flat per-table indexes written by Option 1. */
export const FLAT_INDEXES: string[] = ["invoice-index", "work_order-index"];

/**
 * Alias actions applied at deploy time (Option 1). Per-index aliases abstract
 * the physical index names; the unified `transactions` alias spans both so a
 * single query searches all records.
 */
export const ALIAS_ACTIONS: AliasAction[] = [
  { add: { index: "invoice-index", alias: "invoice" } },
  { add: { index: "work_order-index", alias: "work_order" } },
  { add: { indices: ["invoice-index", "work_order-index"], alias: "transactions" } },
];

/**
 * Explicit create-body for the flat indexes. The id/FK fields are typed
 * `keyword` so exact-match `term` queries (e.g. on the unified `transactions`
 * alias) work; dynamic mapping would otherwise analyze them as `text` and
 * tokenize values like `inv-100`.
 */
export const FLAT_INDEX_BODY: Record<string, unknown> = {
  mappings: {
    properties: {
      invoice_id: { type: "keyword" },
      work_order_id: { type: "keyword" },
    },
  },
};

/** Combined nested index written by Option 2. */
export const COMBINED_INDEX = "invoice-combined";

/** Nested field holding an invoice's work orders in the combined document. */
export const WORK_ORDERS_FIELD = "work_orders";

/**
 * Explicit create-body for the combined index. `work_orders` must be declared
 * `nested` (dynamic mapping would otherwise treat the array of objects as a
 * plain `object`, losing per-element query semantics); id/FK fields are
 * `keyword` for exact-match queries.
 */
export const COMBINED_INDEX_BODY: Record<string, unknown> = {
  mappings: {
    properties: {
      invoice_id: { type: "keyword" },
      [WORK_ORDERS_FIELD]: {
        type: "nested",
        properties: {
          work_order_id: { type: "keyword" },
          invoice_id: { type: "keyword" },
        },
      },
    },
  },
};
