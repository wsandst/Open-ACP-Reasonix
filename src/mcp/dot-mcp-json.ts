// Claude `.mcp.json` reader — project-level MCP config that teams check into git.
// Returns the raw `mcpServers` block so the caller can merge it into `cfg.mcpServers`
// before normalizeMcpConfig runs. Field aliasing (`type` → `transport`,
// `http` → `streamable-http`) happens in inferMcpTransport, not here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "../config.js";

export const DOT_MCP_JSON = ".mcp.json";

/** Iris managed-gateway marker. Older Iris runtimes wrote such entries into the
 * shared `.mcp.json`, pointing at another session's proxy; never load them.
 * Current runtimes hand managed servers over per ACP session (session/new). */
export const IRIS_MANAGED_HEADER = "x-iris-gateway";

export function isIrisManagedEntry(entry: McpServerConfig): boolean {
  const headers = entry.headers;
  if (!headers || typeof headers !== "object") return false;
  return Object.entries(headers).some(
    ([key, value]) => key.toLowerCase() === IRIS_MANAGED_HEADER && value === "managed",
  );
}

export function loadDotMcpJson(projectRoot: string): Record<string, McpServerConfig> | undefined {
  const path = join(projectRoot, DOT_MCP_JSON);
  if (!existsSync(path)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return undefined;
  const out: Record<string, McpServerConfig> = {};
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (isIrisManagedEntry(entry as McpServerConfig)) continue;
    out[name] = entry as McpServerConfig;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
