# Changelog

All notable changes to **Open-ACP-Reasonix** (the fork) are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Semver.

The pre-fork history (every release of `esengine/DeepSeek-Reasonix` up to and
including 0.52.0) is preserved verbatim in [`CHANGELOG-upstream.md`](./CHANGELOG-upstream.md).

## [Unreleased]

### Added
- `LLMClient` interface and `OpenRouterClient` implementation
  ([src/openrouter.ts](src/openrouter.ts)).
- Provider factory `createLLMClient(endpoint)` ([src/llm-factory.ts](src/llm-factory.ts)).
- Data-driven model pricing fetched from OpenRouter `/models`, disk-cached for 24 h
  ([src/telemetry/pricing-cache.ts](src/telemetry/pricing-cache.ts)).
- tiktoken-backed tokenizer with provider-aware encoding picker
  ([src/tokenizer.ts](src/tokenizer.ts)).
- Centralized default model ids ([src/defaults.ts](src/defaults.ts)).
- Live-network OpenRouter smoke test gated by `OPENROUTER_API_KEY`
  ([tests/openrouter-integration.test.ts](tests/openrouter-integration.test.ts)).

### Changed
- Default models swapped to OpenRouter-shaped ids: `openai/gpt-4o-mini` (flash) and
  `openai/gpt-5` (pro). Legacy `deepseek-v4-*` ids remain priced in the fallback
  table for users still pointing at api.deepseek.com.
- `loadEndpoint()` picks OpenRouter first when `OPENROUTER_API_KEY` is set,
  falls back to DeepSeek otherwise.
- Error parser (`formatLoopError`, `is5xxError`) now recognizes both
  `OpenRouter NNN:` and `DeepSeek NNN:` upstream-error prefixes.
- User-facing i18n strings (auth / balance / wizard prompts) name OpenRouter
  as the primary provider with DeepSeek as the alternative.
- Package renamed from `reasonix` to `open-acp-reasonix`.

### Removed
- `dashboard/` (Vite-built React dashboard frontend).
- `desktop/` (Tauri shell + `src/desktop/`).
- `src/server/` (dashboard HTTP/WS server).
- `src/cli/ui/` (Ink-based terminal UI — all components + state + theme).
- `src/qq/` (QQ messenger integration).
- All interactive CLI commands except `acp`, `doctor`, `mcp-inspect`, `version`
  (`chat`, `code`, `run`, `commit`, `setup`, `desktop`, `mcp`, `mcp-runtime`,
  `mcp-browse`, `diff`, `events`, `replay`, `stats`, `sessions`,
  `import-sessions`, `prune-sessions`, `update`).
- Non-English i18n locales (`de`, `ru`, `zh-CN`) and language-detection helpers.
- 24 runtime npm dependencies and 14 dev dependencies that only the UI / dashboard
  / chat-mode used (react, ink, yoga-layout, ws, chalk, lodash-es, jsdom,
  marked, preact, …).
- The DeepSeek V4 BPE tokenizer port (~600 LOC) + `data/deepseek-tokenizer.json.gz`.
- `packages/dsnix` DeepSeek-themed CLI alias.

### Fork notice
This fork is a focused subset of [esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix)
v0.52.0 — the cache-first loop, tool-call repair pipeline, MCP bridging, edit gate,
memory model, session persistence, hooks/skills/semantic-index, and ACP server
implementation are all upstream work. See [README.md](./README.md#credits) for credits.
