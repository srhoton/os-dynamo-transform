import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";

let cachedClient: Client | undefined;

/**
 * Builds (and caches) a SigV4-signed OpenSearch client targeting the
 * OpenSearch Serverless collection.
 *
 * The client signs requests with the `aoss` service name, which is required
 * for OpenSearch Serverless (as opposed to `es` for managed domains). The
 * collection endpoint and region are read from the environment so the same
 * code works across environments without rebuilding.
 *
 * The client is memoized at module scope so warm Lambda invocations reuse a
 * single instance and its underlying connection pool.
 *
 * @returns A configured OpenSearch {@link Client}.
 * @throws {Error} If `OPENSEARCH_ENDPOINT` is not set.
 */
export function getClient(): Client {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  if (endpoint === undefined || endpoint.length === 0) {
    throw new Error("OPENSEARCH_ENDPOINT environment variable is required");
  }

  // AWS_REGION is injected automatically by the Lambda runtime.
  const region = process.env.AWS_REGION ?? "us-west-2";

  cachedClient = new Client({
    ...AwsSigv4Signer({
      region,
      service: "aoss",
      getCredentials: () => {
        const provider = defaultProvider();
        return provider();
      },
    }),
    node: endpoint,
  });

  return cachedClient;
}
