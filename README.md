# Open-ACP-Reasonix

> An [ACP](https://agentclientprotocol.com/)-native, [OpenRouter](https://openrouter.ai/)-first agent backend.
> A focused fork of [**esengine/DeepSeek-Reasonix**](https://github.com/esengine/DeepSeek-Reasonix) —
> the same cache-first loop, tool-call repair pipeline, MCP bridging, and SEARCH/REPLACE edit gate, with
> the interactive TUI / dashboard / desktop surfaces stripped and the DeepSeek-only client swapped for
> a provider-agnostic one.

```
┌─ your fleet ─┐    JSON-RPC over stdio    ┌─ reasonix acp ──────────────────────┐
│  client/orch │ ◄────── (ACP v1) ──────── │  CacheFirstLoop ── OpenRouter      │
└──────────────┘                           │      │            └─ DeepSeek      │
                                           │      ├─ tools (fs, shell, MCP, …) │
                                           │      └─ repair / memory / sessions│
                                           └──────────────────────────────────────┘
```

## Why this fork

The upstream project is a beautifully engineered DeepSeek-native coding agent. The fork's needs were narrower:

1. **Speak ACP from day one** — a clean JSON-RPC-over-stdio surface a multi-agent fleet can spawn, talk to, and supervise.
2. **Run on OpenRouter** — broader model access (OpenAI, Anthropic, Google, DeepSeek, …) with live pricing per model.
3. **Ship as a backend, not a TUI** — no dashboard, no Ink, no React, no Tauri desktop, no interactive `chat`/`code` modes.

What we kept is the engineering work that makes the agent loop actually good:

- The cache-first loop with byte-exact prefix stability (`ImmutablePrefix`, `AppendOnlyLog`)
- The tool-call repair pipeline (flatten, scavenge, truncation-repair, storm-breaker)
- MCP bridging (stdio, SSE, Streamable HTTP)
- The SEARCH/REPLACE edit gate (`src/code/edit-blocks.ts`)
- Session persistence, memory tools, hooks, skills, semantic search
- The ACP server implementation itself

**All credit for the foundation belongs to [esengine](https://github.com/esengine) and the upstream contributors.** See [Credits](#credits) below.

## Install

Node ≥ 22. macOS · Linux · Windows.

```bash
npm install -g open-acp-reasonix
```

Or run via `npx` without installing:

```bash
OPENROUTER_API_KEY=sk-or-... npx open-acp-reasonix acp
```

Get an OpenRouter key at <https://openrouter.ai/keys>. DeepSeek keys (<https://platform.deepseek.com/api_keys>) also work — the client auto-detects which provider you're using.

## Quickstart — ACP

The whole backend is one long-running command:

```bash
OPENROUTER_API_KEY=sk-or-... reasonix acp
```

It speaks newline-delimited JSON-RPC ([Agent Client Protocol v1](https://agentclientprotocol.com/protocol/initialization)) over stdin/stdout. A minimal client conversation:

```jsonl
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{...}}}

→ {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp/work","mcpServers":[]}}
← {"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess_..."}}

→ {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{
    "sessionId":"sess_...",
    "prompt":[{"type":"text","text":"List the files in this directory."}]
  }}
← {"jsonrpc":"2.0","method":"session/update","params":{...agent_message_chunk...}}
← {"jsonrpc":"2.0","method":"session/update","params":{...tool_call...}}
← {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

The full surface — `initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/update` notifications, `session/request_permission` — is in [`src/acp/protocol.ts`](src/acp/protocol.ts).

CLI flags:

| Flag | What |
|---|---|
| `-m, --model <id>` | Override the default model (`openai/gpt-4o-mini`). |
| `--dir <path>` | Filesystem-tools root. Defaults to `cwd`. |
| `--mcp <spec>` | Attach an MCP server. Repeat for multiple. `name=cmd args...` or just `cmd args...`. |
| `--mcp-prefix <str>` | Prefix tools from a single anonymous MCP server. |
| `--yolo` | Skip tool-confirmation gates. **Sandbox only.** |
| `--budget <usd>` | Soft cap — warns at 80 %, refuses next turn at 100 %. |
| `--transcript <path>` | Append every loop event as JSONL (replay / debug). |

## Library usage

If you want to embed the loop directly instead of speaking ACP:

```ts
import {
  CacheFirstLoop,
  ImmutablePrefix,
  OpenRouterClient,
  ToolRegistry,
  registerFilesystemTools,
} from "open-acp-reasonix";

const client = new OpenRouterClient();  // reads OPENROUTER_API_KEY
const tools = new ToolRegistry();
registerFilesystemTools(tools, { rootDir: "/path/to/project" });

const prefix = new ImmutablePrefix({
  system: "You are a coding agent...",
  toolSpecs: tools.specs(),
});

const loop = new CacheFirstLoop({
  client,
  prefix,
  tools,
  model: "openai/gpt-4o-mini",
});

for await (const ev of loop.step("Refactor the auth module")) {
  if (ev.role === "assistant_delta") process.stdout.write(ev.content);
  if (ev.role === "tool_start") console.log(`\n[tool] ${ev.toolName}`);
}
```

The full public surface lives in [`src/index.ts`](src/index.ts) — `CacheFirstLoop`, `OpenRouterClient`, `DeepSeekClient`, `LLMClient`, `ToolRegistry`, `MemoryStore`, `McpClient`, `bridgeMcpTools`, transcript helpers, repair primitives, and more.

## Provider configuration

Resolution order (`src/config.ts` → `loadEndpoint`):

1. `OPENROUTER_API_KEY` env → OpenRouter (overrides everything else).
2. `OPENROUTER_BASE_URL` / `OPENROUTER_API_BASE_URL` env → custom OR-compatible endpoint.
3. `DEEPSEEK_API_KEY` env (+ optional `DEEPSEEK_BASE_URL`) → DeepSeek direct.
4. `~/.reasonix/config.json` `apiKey` / `baseUrl` → whichever provider that key resolves to.

`reasonix doctor` prints which one will be used.

The OpenRouter client picks pricing from a live `/api/v1/models` fetch on first use, cached for 24 h in `~/.reasonix/pricing-cache.json`. Tiktoken handles token counts (o200k_base for modern OpenAI / fallback; cl100k_base for legacy gpt-4 / gpt-3.5).

## What changed vs. upstream

| | Upstream `DeepSeek-Reasonix` | This fork |
|---|---|---|
| LLM provider | DeepSeek only | OpenRouter (primary) + DeepSeek (back-compat) |
| Client surface | `DeepSeekClient` (concrete) | `LLMClient` (interface) + `OpenRouterClient` / `DeepSeekClient` |
| Tokenizer | DeepSeek V4 BPE port (~600 LOC) | `tiktoken` (provider-aware encoding picker) |
| Pricing | Hardcoded static table | Live fetch from OR `/models`, disk-cached |
| Interactive CLI | `chat` / `code` / `run` / `commit` / `setup` / interactive `mcp` | None — `acp` is the only long-running command |
| TUI | Full Ink-based terminal UI | Removed |
| Dashboard | Vite-built SPA + HTTP server + WS | Removed |
| Desktop client | Tauri wrapper | Removed |
| i18n | EN + de + ru + zh-CN | EN only (shim kept for code that calls `t()`) |
| Bundled deps | ~32 runtime, ~30 dev | 10 runtime, 16 dev |

Surviving CLI commands: `acp`, `doctor`, `mcp-inspect`, `version`.

## Architecture (inherited from upstream)

The agent loop is organized around three pillars — all upstream design, kept intact:

- **Pillar 1 — Cache-first loop.** `ImmutablePrefix` is hashed and pinned; `AppendOnlyLog` forbids history rewrites; oversized tool results compact at turn-end (not mid-turn) so the cached prefix stays byte-stable. Originally tuned for DeepSeek's ~99 % cache-read discount, but the byte-stability invariant pays off on every provider that does prefix caching.
- **Pillar 2 — Tool-call repair.** Four passes — flatten oversized arg JSON, scavenge tool calls leaked into reasoning text, repair truncated JSON, break call-storms. Lives in [`src/repair/`](src/repair/).
- **Pillar 3 — Cost control.** Per-turn budget cap, fold-on-overflow context manager, summary-on-stuck. Lives in [`src/loop.ts`](src/loop.ts) + [`src/context-manager.ts`](src/context-manager.ts).

For the long-form design rationale, read the upstream architecture writeup: <https://github.com/esengine/DeepSeek-Reasonix/blob/main/docs/ARCHITECTURE.md>.

## Development

```bash
npm install
npm test            # vitest, 2297 passing
npm run typecheck   # tsc --noEmit
npm run lint        # biome check
npm run build       # tsup → dist/
npm run dev acp     # tsx src/cli/index.ts acp
```

Live-network ACP smoke (needs `OPENROUTER_API_KEY`):

```bash
OPENROUTER_API_KEY=sk-or-... npx vitest run tests/openrouter-integration.test.ts
```

## Credits

This fork stands entirely on [esengine](https://github.com/esengine)'s shoulders. The cache-first loop, tool-call repair pipeline, MCP bridging, ACP server, edit gate, memory model, session persistence, hooks/skills system — all of it is upstream work. The fork's contribution is a provider abstraction layer, an OpenRouter client, a tiktoken-backed tokenizer, live pricing, and the deletion of the surfaces this project didn't need.

**Please star, sponsor, and contribute to [esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix)** — the project this fork depends on for its foundations.

The full upstream contributor roll (every avatar is a real shipped PR):

<https://github.com/esengine/DeepSeek-Reasonix/graphs/contributors>

## License

MIT — same as upstream. See [LICENSE](./LICENSE).
