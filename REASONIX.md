# Open-ACP-Reasonix — working knowledge

TypeScript ACP backend; fork of [esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix).
OpenRouter-first, DeepSeek-compatible. MIT. Node ≥ 22.

## Stack

- **Language** — TS 5.6+, ES2022, ESM (`"type": "module"`)
- **CLI** — Commander.js (no TUI; only long-running command is `acp`)
- **Test** — Vitest 2.x (2297 passing, 0 failing)
- **Lint / Format** — Biome 1.9 (2-space, double quotes, semicolons, 100 width)
- **Build** — tsup; `tsx` for dev runs
- **Tokenizer** — `tiktoken` (o200k_base default; cl100k_base for legacy gpt-4/3.5)
- **MCP** — stdio + SSE + Streamable HTTP transports

## Layout

| Path | What |
|---|---|
| `src/acp/` | ACP server: `protocol.ts`, `server.ts`, `dispatch.ts`, `gates.ts` |
| `src/cli/index.ts` | CLI entry — registers `acp`, `doctor`, `mcp-inspect`, `version` |
| `src/cli/commands/` | Surviving commands (4 total) |
| `src/client.ts` | `LLMClient` interface + `DeepSeekClient` |
| `src/openrouter.ts` | `OpenRouterClient` (OR-compatible chat-completions transport) |
| `src/llm-factory.ts` | `createLLMClient(endpoint)` provider picker |
| `src/defaults.ts` | Single source of truth for default model ids |
| `src/loop.ts` + `src/loop/` | `CacheFirstLoop` — turn iteration, streaming, error categorization |
| `src/context-manager.ts` | Auto-fold on overflow, summarize-on-stuck |
| `src/repair/` | Tool-call repair pipeline (flatten / scavenge / truncation / storm) |
| `src/code/` | SEARCH/REPLACE edit blocks + apply gate + code-mode prompt |
| `src/code-query/` | Tree-sitter-backed symbol/range search |
| `src/index/semantic/` | Semantic vector index (Ollama / OpenAI-compat embeddings) |
| `src/memory/` | Project / user / session / runtime memory stores |
| `src/mcp/` | MCP client + transports + bridge + format helpers |
| `src/tools/` | Filesystem, shell, plan, todo, subagent, web, code-query, skills |
| `src/telemetry/` | `stats.ts` (usage rollups) + `pricing-cache.ts` (live OR fetch) |
| `src/transcript/` | JSONL transcript log + replay + diff |
| `src/tokenizer.ts` | tiktoken wrapper with model→encoding picker |
| `src/i18n/` | EN-only translation shim (locales removed; shim kept for `t()` callers) |
| `tests/` | Vitest, flat `*.test.ts` |
| `scripts/` | One-off perf probes + tree-sitter grammar copier |

## Commands

```sh
npm run build       # tsup → dist/
npm run dev acp     # tsx src/cli/index.ts acp
npm run test        # vitest run
npm run lint        # biome check src tests
npm run lint:fix    # biome check --write src tests
npm run typecheck   # tsc --noEmit
npm run verify      # lint → typecheck → test
```

## Conventions

- **Imports** — `import type` for type-only; no barrel re-exports; relative within project.
- **Exports** — named only; no `export default`. Library entry: `src/index.ts`.
- **Tests** — vitest `describe`/`it`/`expect`, no globals. Flat `tests/<module>.test.ts`.
- **TypeScript** — `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Tools accept `ToolCallContext` (abort signal).
- **Comments** — One-line max for non-obvious WHY. CLAUDE.md comment-policy enforced by `tests/comment-policy.test.ts` (≤ 3-line block comments, ≤ 2-line module headers).
- **Provider abstraction** — Code that talks to the model uses `LLMClient` (interface), not `DeepSeekClient` / `OpenRouterClient` directly. Construction sites use `createLLMClient(loadEndpoint())`.

## Watch out for

- **ACP is the product** — `src/acp/` is the integration surface other tools speak to. Don't change protocol fields without updating ACP v1 conformance.
- **Cache stability is load-bearing** — `ImmutablePrefix` is hashed and pinned; mutations outside its sanctioned methods throw. Don't add timestamps / dynamic content to the system prompt.
- **SEARCH must match byte-for-byte** — the edit-gate in `src/code/edit-blocks.ts` enforces exact match. Trailing whitespace / wrong indent = mismatch.
- **`dist/` and `~/.reasonix/`** are generated; never hand-edit. The pricing-cache lives at `~/.reasonix/pricing-cache.json`.
- **Provider detection** — `loadEndpoint()` picks OpenRouter first when `OPENROUTER_API_KEY` is set; a stale `DEEPSEEK_API_KEY` in the shell does NOT silently override. Don't change that precedence without an `acp.ts` integration test.

## Upstream parity

The agent loop, repair pipeline, MCP bridging, edit gate, memory model, session persistence, hooks, skills, and ACP server implementation are all upstream work from [esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix). When upstream lands a relevant fix, the merge surface is concentrated in:

- `src/client.ts` (provider interface)
- `src/openrouter.ts` (fork-only)
- `src/llm-factory.ts` (fork-only)
- `src/defaults.ts` (fork-only — model ids)
- `src/telemetry/{stats,pricing-cache}.ts` (provider-aware pricing)
- `src/tokenizer.ts` (tiktoken replacement)
- `src/cli/index.ts` (rewritten)
- Everything under `src/cli/ui/`, `src/server/`, `src/desktop/`, `dashboard/`, `desktop/` was **deleted in this fork** — upstream changes there don't apply.

Read `REWORK_CHAT.md` at the repo root for the full pre-rework analysis (~4-6% of upstream LOC is actually fork-specific; everything else auto-merges).
