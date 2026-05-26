import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPricingCache,
  ensurePricingCacheFresh,
  getCachedPricing,
  refreshPricingCache,
} from "../src/telemetry/pricing-cache.js";

let dir: string;
let cachePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reasonix-pricing-"));
  cachePath = join(dir, "pricing-cache.json");
  _resetPricingCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  _resetPricingCache();
});

function fakeFetch(payload: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("refreshPricingCache", () => {
  it("converts per-token strings into per-1M numbers and writes the cache file", async () => {
    const fetchSpy = fakeFetch({
      data: [
        {
          id: "openai/gpt-4o-mini",
          pricing: {
            prompt: "0.00000015",
            completion: "0.0000006",
            input_cache_read: "0.0000000750",
          },
        },
      ],
    });
    const map = await refreshPricingCache({ cachePath, fetch: fetchSpy });
    const p = map.get("openai/gpt-4o-mini");
    expect(p).toBeDefined();
    expect(p!.inputCacheMiss).toBeCloseTo(0.15, 6);
    expect(p!.output).toBeCloseTo(0.6, 6);
    expect(p!.inputCacheHit).toBeCloseTo(0.075, 6);

    const disk = JSON.parse(readFileSync(cachePath, "utf8")) as {
      fetchedAt: number;
      byModel: Record<string, unknown>;
    };
    expect(typeof disk.fetchedAt).toBe("number");
    expect(disk.byModel["openai/gpt-4o-mini"]).toBeDefined();
  });

  it("defaults cache-hit to cache-miss when input_cache_read is missing", async () => {
    const fetchSpy = fakeFetch({
      data: [
        {
          id: "anthropic/claude-sonnet-4.6",
          pricing: { prompt: "0.000003", completion: "0.000015" },
        },
      ],
    });
    const map = await refreshPricingCache({ cachePath, fetch: fetchSpy });
    const p = map.get("anthropic/claude-sonnet-4.6")!;
    expect(p.inputCacheHit).toBeCloseTo(p.inputCacheMiss, 6);
  });

  it("skips malformed entries instead of polluting the map", async () => {
    const fetchSpy = fakeFetch({
      data: [
        { id: "ok/model", pricing: { prompt: "0.000001", completion: "0.000002" } },
        { id: "no-pricing/x" },
        { id: "garbage/y", pricing: { prompt: "not-a-number", completion: "0.0" } },
        { pricing: { prompt: "0.0", completion: "0.0" } },
      ],
    });
    const map = await refreshPricingCache({ cachePath, fetch: fetchSpy });
    expect(map.has("ok/model")).toBe(true);
    expect(map.has("no-pricing/x")).toBe(false);
    expect(map.has("garbage/y")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("returns the existing in-memory cache on fetch failure rather than throwing", async () => {
    // Prime mem cache via a successful refresh.
    const okSpy = fakeFetch({
      data: [{ id: "old/model", pricing: { prompt: "0.000001", completion: "0.000002" } }],
    });
    await refreshPricingCache({ cachePath, fetch: okSpy });
    expect(getCachedPricing("old/model")).toBeDefined();

    // Now a refresh that fails — must not throw; mem cache must survive.
    const failSpy = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(refreshPricingCache({ cachePath, fetch: failSpy })).resolves.toBeInstanceOf(Map);
    expect(getCachedPricing("old/model")).toBeDefined();
  });

  it("dedupes concurrent refresh calls — only one network round-trip per refresh window", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await Promise.all([
      refreshPricingCache({ cachePath, fetch: fetchSpy }),
      refreshPricingCache({ cachePath, fetch: fetchSpy }),
      refreshPricingCache({ cachePath, fetch: fetchSpy }),
    ]);
    expect(calls).toBe(1);
  });
});

describe("ensurePricingCacheFresh", () => {
  it("does NOT refresh when the disk cache is younger than maxAgeMs", () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: Date.now() - 60_000,
        byModel: { "x/y": { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
      }),
    );
    const fetchSpy = fakeFetch({ data: [] });
    ensurePricingCacheFresh({ cachePath, fetch: fetchSpy, maxAgeMs: 5 * 60_000 });
    expect(fetchSpy).not.toHaveBeenCalled();
    // Disk cache populated mem cache eagerly so subsequent lookups skip the fetch.
    expect(getCachedPricing("x/y")).toBeDefined();
  });

  it("triggers a background refresh when the cache is stale", async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: Date.now() - 25 * 60 * 60 * 1_000,
        byModel: {},
      }),
    );
    const fetchSpy = fakeFetch({
      data: [
        {
          id: "fresh/model",
          pricing: { prompt: "0.000001", completion: "0.000002" },
        },
      ],
    });
    ensurePricingCacheFresh({ cachePath, fetch: fetchSpy, maxAgeMs: 24 * 60 * 60 * 1_000 });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getCachedPricing("fresh/model")).toBeDefined();
  });
});
