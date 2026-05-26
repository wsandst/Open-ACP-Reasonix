import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bridgeEndpointEnv, loadEndpoint } from "../src/config.js";

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_API_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_API_BASE_URL",
];

let dir: string;
let cfgPath: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reasonix-endpoint-"));
  cfgPath = join(dir, "config.json");
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("loadEndpoint priority order", () => {
  it("OPENROUTER_API_KEY beats every other signal", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-from-env";
    process.env.DEEPSEEK_API_KEY = "sk-ds-stale";
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    writeFileSync(cfgPath, JSON.stringify({ apiKey: "sk-ds-cfg", baseUrl: "https://cfg.example" }));
    const ep = loadEndpoint(cfgPath);
    expect(ep.provider).toBe("openrouter");
    expect(ep.apiKey).toBe("sk-or-from-env");
  });

  it("OPENROUTER_API_BASE_URL is accepted as an alias for OPENROUTER_BASE_URL", () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    process.env.OPENROUTER_API_BASE_URL = "https://or-alias.example/v1";
    const ep = loadEndpoint(cfgPath);
    expect(ep.baseUrl).toBe("https://or-alias.example/v1");
  });

  it("DEEPSEEK_BASE_URL env wins over config when no OPENROUTER key is set", () => {
    process.env.DEEPSEEK_BASE_URL = "https://env.example/v1";
    process.env.DEEPSEEK_API_KEY = "sk-ds-env";
    writeFileSync(cfgPath, JSON.stringify({ apiKey: "sk-cfg", baseUrl: "https://cfg.example/v1" }));
    const ep = loadEndpoint(cfgPath);
    expect(ep.provider).toBe("deepseek");
    expect(ep.baseUrl).toBe("https://env.example/v1");
    expect(ep.apiKey).toBe("sk-ds-env");
  });

  it("DEEPSEEK_API_BASE_URL is accepted as an alias for DEEPSEEK_BASE_URL", () => {
    process.env.DEEPSEEK_API_BASE_URL = "https://ds-alias.example/v1";
    const ep = loadEndpoint(cfgPath);
    expect(ep.baseUrl).toBe("https://ds-alias.example/v1");
  });

  it("config.baseUrl is used when no relevant env vars are present", () => {
    writeFileSync(cfgPath, JSON.stringify({ apiKey: "sk-cfg", baseUrl: "https://cfg.example/v1" }));
    const ep = loadEndpoint(cfgPath);
    expect(ep.provider).toBe("deepseek");
    expect(ep.baseUrl).toBe("https://cfg.example/v1");
    expect(ep.apiKey).toBe("sk-cfg");
  });

  it("falls through to DEEPSEEK_API_KEY at the default origin when nothing else matches", () => {
    process.env.DEEPSEEK_API_KEY = "sk-ds-only";
    const ep = loadEndpoint(cfgPath);
    expect(ep.provider).toBe("deepseek");
    expect(ep.baseUrl).toBeUndefined();
    expect(ep.apiKey).toBe("sk-ds-only");
  });
});

describe("bridgeEndpointEnv", () => {
  it("mirrors a resolved OpenRouter endpoint into the OPENROUTER_* env vars", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-source";
    process.env.OPENROUTER_BASE_URL = "https://or.example/v1";
    // Wipe DS vars to assert bridge only touches the active provider's slot.
    // biome-ignore lint/performance/noDelete: env must be truly unset — assigning undefined leaves the literal string "undefined".
    delete process.env.DEEPSEEK_API_KEY;
    // biome-ignore lint/performance/noDelete: env must be truly unset — assigning undefined leaves the literal string "undefined".
    delete process.env.DEEPSEEK_BASE_URL;
    bridgeEndpointEnv(cfgPath);
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-source");
    expect(process.env.OPENROUTER_BASE_URL).toBe("https://or.example/v1");
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("mirrors a resolved DeepSeek endpoint into the DEEPSEEK_* env vars", () => {
    writeFileSync(cfgPath, JSON.stringify({ apiKey: "sk-ds", baseUrl: "https://ds.example/v1" }));
    bridgeEndpointEnv(cfgPath);
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-ds");
    expect(process.env.DEEPSEEK_BASE_URL).toBe("https://ds.example/v1");
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  });
});
