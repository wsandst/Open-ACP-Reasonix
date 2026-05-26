# Architecture

The agent-loop architecture is upstream work and lives there in long form:

> 📘 **Full design rationale (upstream):**
> <https://github.com/esengine/DeepSeek-Reasonix/blob/main/docs/ARCHITECTURE.md>

What follows is a short tour of what the fork preserves, and how the
provider-abstraction layer fits on top.

## Three pillars (inherited)

### Pillar 1 — Cache-first loop

The loop partitions context into three regions so the byte-stable bits
maximize prefix-cache hits:

```
┌─────────────────────────────────────────┐
│ IMMUTABLE PREFIX                        │ ← fixed for session
│   system + tool_specs + few_shots       │   hashed and pinned
├─────────────────────────────────────────┤
│ APPEND-ONLY LOG                         │ ← grows monotonically
│   [assistant₁][tool₁][assistant₂]...    │   no rewrites
├─────────────────────────────────────────┤
│ VOLATILE SCRATCH                        │ ← reset each turn
│   reasoning, transient plan state       │   never sent upstream
└─────────────────────────────────────────┘
```

Invariants:

1. Prefix is computed once per session, hashed, and pinned. Mutations outside
   sanctioned methods throw at test time.
2. Log entries serialize in append order; no rewrites.
3. Oversized tool results compact at turn-end (not mid-turn), so a paid-for
   cache window stays byte-stable for the next call.

Originally tuned for DeepSeek's ~99 % cache-read discount. OpenRouter's cache
discounts vary by model (`prompt_tokens_details.cached_tokens` in the usage
field) — the loop reports both metrics regardless.

Code: [`src/loop.ts`](../src/loop.ts) + [`src/memory/runtime.ts`](../src/memory/runtime.ts).

### Pillar 2 — Tool-call repair

Four passes that recover from model output failures without retry:

| Pass | What | Code |
|---|---|---|
| Flatten | Oversized argument JSON gets summarized and re-emitted | [`src/repair/flatten.ts`](../src/repair/flatten.ts) |
| Scavenge | Tool calls leaked into reasoning text get recovered | [`src/repair/scavenge.ts`](../src/repair/scavenge.ts) |
| Truncation repair | Cut-off JSON gets balanced and parsed | [`src/repair/truncation.ts`](../src/repair/truncation.ts) |
| Storm breaker | Repeated identical calls trigger force-summary | [`src/repair/storm.ts`](../src/repair/storm.ts) |

Originally tuned for DeepSeek R1's specific output quirks. The scavenger's
DSML regex patterns are R1-specific but they no-op on every other provider,
so leaving the pipeline on is free.

### Pillar 3 — Cost control

- Per-turn USD budget cap (soft warn at 80 %, refuse at 100 %)
- Auto-fold when prompt-token count crosses a configurable threshold
- Force-summary when the loop gets stuck (storm + N consecutive identical errors)

Code: [`src/loop.ts`](../src/loop.ts) + [`src/context-manager.ts`](../src/context-manager.ts) + [`src/loop/force-summary.ts`](../src/loop/force-summary.ts).

## Fork additions

### Provider abstraction

```
            ┌── LLMClient (interface) ──┐
            │                            │
   OpenRouterClient              DeepSeekClient
   (src/openrouter.ts)            (src/client.ts)
            │                            │
            └────── chat / stream ───────┘
                    + getBalance
                    + listModels
                    + baseUrl
```

The loop, subagents, context-manager, streaming helpers, and ACP server all
depend on `LLMClient`. Concrete construction happens once per session via
`createLLMClient(loadEndpoint())` in [`src/llm-factory.ts`](../src/llm-factory.ts).

### Data-driven pricing

[`src/telemetry/pricing-cache.ts`](../src/telemetry/pricing-cache.ts) fetches
OpenRouter's `/api/v1/models` on first use and caches the per-model prices to
`~/.reasonix/pricing-cache.json` with a 24 h TTL. `pricingFor(model)` consults
this cache before falling back to the static table.

### Provider-aware tokenizer

[`src/tokenizer.ts`](../src/tokenizer.ts) routes `gpt-4o*` / `gpt-5*` / `o3*`
through tiktoken's `o200k_base`, legacy `gpt-4` / `gpt-3.5` through `cl100k_base`,
and falls back to `o200k_base` for everything else (5-15 % drift on Claude /
Gemini / DeepSeek — fine for budget heuristics; the API returns the real
`usage.prompt_tokens` after every turn).

## Endpoint resolution

```
OPENROUTER_API_KEY env?          → OpenRouter
  └─ no:
     OPENROUTER_BASE_URL env?    → OpenRouter at that base
       └─ no:
          DEEPSEEK_BASE_URL env? → DeepSeek at that base
            └─ no:
               config.baseUrl?   → whichever provider that resolves to
                 └─ no:
                    DEEPSEEK_API_KEY env or config.apiKey → DeepSeek default
```

Source: [`src/config.ts:loadEndpoint`](../src/config.ts).

## ACP

`src/acp/` is the integration surface — JSON-RPC over stdio, ACP v1. The CLI
entry (`reasonix acp`) is a thin wrapper around `AcpServer` that wires in the
factory-built client, builds the code-mode toolset, and bridges MCP servers
specified via `--mcp`. See [`src/cli/commands/acp.ts`](../src/cli/commands/acp.ts).
