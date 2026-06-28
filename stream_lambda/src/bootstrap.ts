import type { Client } from "@opensearch-project/opensearch";

import {
  ALIAS_ACTIONS,
  COMBINED_INDEX,
  COMBINED_INDEX_BODY,
  FLAT_INDEX_BODY,
  FLAT_INDEXES,
} from "./aliases";
import { getClient } from "./opensearchClient";
import { statusCodeOf } from "./record";

/**
 * Creates an index if it does not already exist. The
 * `resource_already_exists_exception` (HTTP 400) is treated as success so the
 * bootstrap is idempotent across repeated deploys.
 */
async function ensureIndex(
  client: Client,
  index: string,
  body?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.indices.create(body === undefined ? { index } : { index, body });
    console.info(JSON.stringify({ msg: "bootstrap-index-created", index }));
  } catch (err: unknown) {
    if (statusCodeOf(err) === 400) {
      console.info(JSON.stringify({ msg: "bootstrap-index-exists", index }));
      return;
    }
    throw err;
  }
}

/**
 * Deploy-time Lambda handler. Provisions the data-plane objects Terraform
 * cannot manage directly:
 *
 *  - ensures the flat per-table indexes exist (Option 1),
 *  - creates the combined nested index with its explicit mapping (Option 2),
 *  - applies the per-index and unified aliases (Option 1).
 *
 * Idempotent: safe to re-run on every deploy. Throws on real failure so the
 * Terraform invocation surfaces the error.
 */
export async function handler(): Promise<{
  ok: true;
  indexes: string[];
  aliases: string[];
}> {
  const client = getClient();

  for (const index of FLAT_INDEXES) {
    await ensureIndex(client, index, FLAT_INDEX_BODY);
  }
  await ensureIndex(client, COMBINED_INDEX, COMBINED_INDEX_BODY);

  await client.indices.updateAliases({ body: { actions: ALIAS_ACTIONS } });

  const aliases = ALIAS_ACTIONS.map((a) => a.add.alias);
  console.info(JSON.stringify({ msg: "bootstrap-complete", aliases }));

  return { ok: true, indexes: [...FLAT_INDEXES, COMBINED_INDEX], aliases };
}
