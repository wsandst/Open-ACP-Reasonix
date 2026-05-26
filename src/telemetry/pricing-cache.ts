/** Live pricing fetched from OpenRouter's /models endpoint, cached to disk so
 *  cost rows survive a process restart without paying the round trip again. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelPricing } from "./stats.js";

const DEFAULT_CACHE_PATH = join(homedir(), ".reasonix", "pricing-cache.json");
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_PRICING_ENDPOINT = "https://openrouter.ai/api/v1/models";

interface PricingCacheFile {
  fetchedAt: number;
  byModel: Record<string, ModelPricing>;
}

/** In-memory map populated from disk on first access; background-refreshed on
 *  startup. `null` value = model is known-priced as zero (rare). `undefined` =
 *  unknown to the cache, callers should fall back to the static table. */
let memCache: Map<string, ModelPricing> | null = null;
let inflightRefresh: Promise<Map<string, ModelPricing>> | null = null;

function loadFromDisk(path: string = DEFAULT_CACHE_PATH): PricingCacheFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as PricingCacheFile;
    if (typeof parsed?.fetchedAt !== "number" || typeof parsed?.byModel !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeToDisk(file: PricingCacheFile, path: string = DEFAULT_CACHE_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
  } catch {
    /* best-effort cache write; cost rows will just refetch next run */
  }
}

interface RawORModel {
  id?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
  };
}

/** Per-token strings → per-1M-token numbers; non-numeric/missing fields drop. */
function parsePricing(raw: RawORModel): ModelPricing | null {
  const p = raw.pricing;
  if (!p) return null;
  const cacheMiss = Number(p.prompt);
  const output = Number(p.completion);
  if (!Number.isFinite(cacheMiss) || !Number.isFinite(output)) return null;
  const cacheHitRaw = Number(p.input_cache_read);
  const cacheHit = Number.isFinite(cacheHitRaw) && cacheHitRaw >= 0 ? cacheHitRaw : cacheMiss;
  return {
    inputCacheHit: cacheHit * 1_000_000,
    inputCacheMiss: cacheMiss * 1_000_000,
    output: output * 1_000_000,
  };
}

async function fetchPricing(
  endpoint: string,
  fetchImpl: typeof fetch,
): Promise<Map<string, ModelPricing>> {
  const resp = await fetchImpl(endpoint, {
    method: "GET",
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) throw new Error(`pricing fetch ${resp.status}`);
  const json = (await resp.json()) as { data?: RawORModel[] };
  const data = Array.isArray(json?.data) ? json.data : [];
  const map = new Map<string, ModelPricing>();
  for (const m of data) {
    if (!m?.id) continue;
    const priced = parsePricing(m);
    if (priced) map.set(m.id, priced);
  }
  return map;
}

export interface PricingCacheOptions {
  /** Override cache file path — tests point this at a tmp file. */
  cachePath?: string;
  /** Reject entries older than this. Default 24h. */
  maxAgeMs?: number;
  /** Override the pricing endpoint URL — tests pin a local fake. */
  endpoint?: string;
  /** Override fetch — tests inject a vi.fn(). */
  fetch?: typeof fetch;
}

/** Synchronous lookup. Returns undefined when the model isn't in cache;
 *  callers should fall back to the static fallback table. */
export function getCachedPricing(model: string): ModelPricing | undefined {
  if (memCache === null) {
    const disk = loadFromDisk();
    memCache = disk ? new Map(Object.entries(disk.byModel)) : new Map();
  }
  return memCache.get(model);
}

/** Force a refresh from the network; writes the result to disk + memory.
 *  Returns the existing cache on failure rather than throwing. */
export async function refreshPricingCache(
  opts: PricingCacheOptions = {},
): Promise<Map<string, ModelPricing>> {
  if (inflightRefresh) return inflightRefresh;
  const endpoint = opts.endpoint ?? DEFAULT_PRICING_ENDPOINT;
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const cachePath = opts.cachePath ?? DEFAULT_CACHE_PATH;
  inflightRefresh = (async () => {
    try {
      const map = await fetchPricing(endpoint, fetchImpl);
      memCache = map;
      writeToDisk({ fetchedAt: Date.now(), byModel: Object.fromEntries(map) }, cachePath);
      return map;
    } catch {
      // Keep whatever's in memory.
      if (memCache) return memCache;
      memCache = new Map();
      return memCache;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

/** Background refresh if the disk cache is missing or stale. Fire-and-forget;
 *  never throws. Call from CacheFirstLoop construction. */
export function ensurePricingCacheFresh(opts: PricingCacheOptions = {}): void {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const cachePath = opts.cachePath ?? DEFAULT_CACHE_PATH;
  const disk = loadFromDisk(cachePath);
  if (disk && Date.now() - disk.fetchedAt < maxAgeMs) {
    if (memCache === null) memCache = new Map(Object.entries(disk.byModel));
    return;
  }
  void refreshPricingCache(opts).catch(() => {
    /* swallow — fallback table covers any miss */
  });
}

/** Test-only reset. */
export function _resetPricingCache(): void {
  memCache = null;
  inflightRefresh = null;
}
