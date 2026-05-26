/** Thin factory: ResolvedEndpoint → LLMClient. Kept in its own module so neither
 *  src/client.ts (DeepSeek) nor src/openrouter.ts have to import the other. */

import { DeepSeekClient, type LLMClient } from "./client.js";
import { type ResolvedEndpoint, loadEndpoint } from "./config.js";
import { OpenRouterClient } from "./openrouter.js";

export interface CreateLLMClientOptions {
  /** Forward to the underlying client's fetch hook — used by tests. */
  fetch?: typeof fetch;
}

export function createLLMClient(
  endpoint: ResolvedEndpoint,
  opts: CreateLLMClientOptions = {},
): LLMClient {
  if (endpoint.provider === "openrouter") {
    return new OpenRouterClient({
      apiKey: endpoint.apiKey,
      baseUrl: endpoint.baseUrl,
      fetch: opts.fetch,
    });
  }
  return new DeepSeekClient({
    apiKey: endpoint.apiKey,
    baseUrl: endpoint.baseUrl,
    fetch: opts.fetch,
  });
}

/** Convenience: resolve endpoint + construct in one call. Most call sites want this. */
export function loadLLMClient(opts: CreateLLMClientOptions = {}): LLMClient {
  return createLLMClient(loadEndpoint(), opts);
}
