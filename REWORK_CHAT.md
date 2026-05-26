# DeepSeek-Reasonix Analysis & OpenRouter Rework

A working chat exploring the [esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) repository — what its DeepSeek coupling actually looks like, how it'd be integrated into a custom frontend, and what it would take to fork it into a model-agnostic harness via OpenRouter.

---

## 1. Is "DeepSeek-optimized" actually DeepSeek-specific?

**Initial hypothesis:** the repo claims to be optimized for DeepSeek, but it looks like it's really just optimized around prefix caching, which every major model supports automatically (except Anthropic). Is that right?

### Where the hypothesis is right

Prefix caching is essentially universal now. OpenAI, Gemini, and DeepSeek do it implicitly (automatic, no code changes); Anthropic requires explicit `cache_control` breakpoints; the discount on cache reads is broadly similar (~10% of miss rate on DeepSeek/Anthropic, 25-50% on OpenAI). The *mechanism* isn't DeepSeek-specific in any deep sense.

### Where the repo is doing something real

The README talks like prefix caching is the feature, but reading the actual code, the engineering work is **byte-exact prefix stability across an agent loop** — not the caching itself. That's a different problem:

- `ImmutablePrefix` is hashed, pinned, and any mutation invalidates a fingerprint — tests throw if anything mutates the prefix outside the sanctioned methods (`src/memory/runtime.ts:74`).
- `AppendOnlyLog` forbids rewrites of history. Most agent frameworks compact, reorder, or re-summarize on each turn, which kills the cache.
- Tool results over 3000 tokens get compacted at *turn end*, not mid-turn — so the prefix you already paid to cache stays byte-stable.
- No injected timestamps, no reordering.

This part isn't DeepSeek-specific at all — it would help equally on OpenAI, Gemini, or Anthropic.

### The actually-DeepSeek-specific bits (small surface)

1. **`reasoning_content` field** — DeepSeek's name for chain-of-thought. Referenced 62 times across the codebase.
2. **`extra_body.thinking.type`** toggle — DeepSeek proprietary.
3. **`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`** in usage — DeepSeek's specific field names.
4. **Pillar 3 "Tool-Call Repair"** — has fixes for specific DeepSeek failure modes (tool calls leaking into `<think>` blocks, the "call-storm" pattern).
5. **Pricing table** is DeepSeek-only and hardcoded.
6. **`/balance` endpoint** is DeepSeek-specific.
7. **Tokenizer is "DeepSeek V3 tokenizer (ported)"** — used for context-window accounting.

The architecture doc's own non-goals section admits: *"an OpenAI-compatible shim would work today via --model override, but is not tested."*

---

## 2. Programmatic / integration surface

The repo is unusually well-suited to a custom frontend. There are **three integration tiers**:

### Tier 1: The library — `CacheFirstLoop` as a class

The whole agent is exposed as a library export. Hello-world is about 25 lines:

```typescript
import { CacheFirstLoop, DeepSeekClient, ImmutablePrefix, ToolRegistry } from "reasonix";
import { registerFilesystemTools } from "reasonix";

const client = new DeepSeekClient({ apiKey, baseUrl });    // ← swap point for OpenRouter
const tools = new ToolRegistry();
registerFilesystemTools(tools, { rootDir: "/path/to/project" });

const prefix = new ImmutablePrefix({
  system: "You are a coding agent...",
  toolSpecs: tools.specs(),
});

const loop = new CacheFirstLoop({ client, prefix, tools, model: "deepseek-v4-flash" });

// Two consumption styles:
// (a) async iterator — fine-grained events
for await (const ev of loop.step("Refactor the auth module")) {
  handleEvent(ev);
}

// (b) callback + final string — one-shot
const finalAnswer = await loop.run("Refactor the auth module", (ev) => handleEvent(ev));
```

The `LoopEvent` shape:

```typescript
{
  turn: number;
  role: "assistant_delta" | "assistant_final" | "tool_call_delta"
      | "tool_start" | "tool" | "done" | "error" | "warning"
      | "status" | "steer";
  content: string;
  reasoningDelta?: string;       // CoT stream
  toolName?: string;
  toolArgs?: string;             // raw JSON
  toolCallArgsChars?: number;    // streaming progress for big args
  callId?: string;               // stable ID — pair tool_start ↔ tool
  stats?: TurnStats;             // usage, cost, cache hit ratio
  severity?: "low" | "high";
  error?: string;
  forcedSummary?: boolean;
}
```

Useful library exports:
- `loop.steer(text)` — inject mid-turn user guidance without aborting
- `loop.abort({ discardCurrentTurn: true })` — interrupt; threaded through every fetch + tool call
- `loop.stats.summary()` — turns, cache-hit ratio, cost
- `loop.inflight` — `Set<callId>`; subscribe to know which tool cards are still running
- `loadSessionMessages(name)` / `appendSessionMessage(...)` — JSONL session persistence
- `parseTranscript` / `replayFromFile` / `diffTranscripts` — replay & A/B
- `bridgeMcpTools(mcpClient, { registry })` — pull MCP server tools into the registry

**Caveat:** `CacheFirstLoop` is single-tenant by construction. One loop instance = one prefix = one session. For multi-tenant (many concurrent users), spawn one loop per session, or use Tier 3 below.

### Tier 2: The HTTP dashboard server — *not* the integration target

There's a built-in HTTP server (`startDashboardServer`) with a full REST surface and an SSE event stream at `/api/events`. **But** it requires an attached TUI/CLI session — `submit` returns 503 if `ctx.submitPrompt` is null. So this is a *companion* surface for the interactive CLI, not a standalone backend.

### Tier 3: ACP (Agent Client Protocol) — **probably what you actually want**

The repo ships a full ACP implementation (`src/acp/`, `src/cli/commands/acp.ts`). ACP is a JSON-RPC-over-stdio protocol designed exactly for "custom frontend talking to an agent backend." It's the same protocol Zed uses to talk to Claude Code, gemini-cli, etc.

You spawn `reasonix acp` as a subprocess and pipe NDJSON JSON-RPC over stdin/stdout. The methods:

| Method | Direction | Purpose |
|---|---|---|
| `initialize` | client → agent | Handshake, get protocol version + capabilities |
| `session/new` | client → agent | Create a session, returns `sessionId` |
| `session/prompt` | client → agent | Send user message; returns `StopReason` when done |
| `session/cancel` | client → agent | Interrupt |
| `session/update` | agent → client (notification) | Streamed updates |
| `session/request_permission` | agent → client | Tool gate (shell, edits, etc.) |

`session/update` notifications carry `agent_message_chunk` (streaming text), `agent_thought_chunk` (streaming CoT), `tool_call` / `tool_call_update` (with status: `pending` → `in_progress` → `completed`/`failed`), and `plan` updates.

### Map of files worth knowing

- `src/cli/commands/run.ts` — 200 lines, **read this first** as a minimal embedding example
- `src/cli/commands/acp.ts` — full ACP example with MCP, transcripts, budget
- `src/loop.ts` — main loop class, ~1050 lines
- `src/loop/types.ts` — `LoopEvent` shape (47 lines)
- `src/acp/protocol.ts` — full ACP type definitions
- `src/index.ts` — public library exports (372 lines, comprehensive)

For OpenRouter, the only file you *must* touch is `src/client.ts` (~370 lines). Optional second touch: `src/telemetry/stats.ts` to make pricing data-driven.

---

## 3. ACP as the fleet integration target

For a fleet integrating against Claude Code, Codex, and Reasonix:

**Yes, design against ACP.** Ecosystem state as of May 2026:
- **Claude Code** has an ACP adapter (`@zed-industries/claude-code-acp`) maintained jointly by Zed and the `agentclientprotocol` org. It wraps the official Claude Agent SDK.
- **Codex CLI** is in the ACP Registry.
- **Reasonix** ships native ACP.
- **The protocol itself** is open source under Apache, has a registry, and is being adopted by JetBrains, Zed, neovim, Obsidian.

### Why ACP beats tmux + custom protocols

1. **Parsing TUI output.** tmux gives you a terminal buffer; you'd scrape ANSI escape codes. ACP gives you typed JSON-RPC notifications — nothing to parse.
2. **Driving input.** With tmux you're sending keystrokes and praying about prompt state. ACP gives you `session/prompt` for input and `session/request_permission` as an explicit RPC for gating.
3. **Multiplexing.** tmux sessions are heavy. ACP gives you `session/new` returning a `sessionId`, and you can multiplex many sessions over a single subprocess connection.

### Gotchas before committing

- **ACP is young and the spec is still moving.** Version 1 is what Reasonix targets. Stable enough but expect minor breaking changes; pin versions, watch the changelog.
- **The Claude Code ACP adapter is a wrapper.** It runs the Claude Agent SDK underneath. Some Claude Code-specific features won't be reachable through the adapter.
- **Codex's ACP support is via the CLI.** Extra layer compared to talking to OpenAI directly.
- **Reasonix's ACP is comprehensive but the project is relatively new.** Treat it like any other young dependency.
- **Permission flow is sync-ish.** `session/request_permission` blocks the agent's turn until the client responds. For autonomous fleet agents, you need a policy layer that auto-responds. The protocol doesn't ship a policy engine.

### What to build for a fleet

A single **ACP client library** that handles:
- Spawning the agent as a subprocess with the right working directory and env
- Sending `initialize` → `session/new` → `session/prompt`
- Multiplexing `session/update` notifications back to your event bus
- An auto-permission policy
- Health checks and process supervision

Each agent (Reasonix, Claude Code via adapter, Codex via CLI) is then just "spawn this binary with these args, speak ACP to its stdio." Adding a fourth agent is a config entry.

### What ACP doesn't give you

- No fleet orchestration. 1-to-1 protocol between one client and one agent process.
- No persistence layer. Session state is in-process.
- No cross-agent context sharing.
- No cost/usage telemetry normalization. Each agent reports its own way — build the normalizer once.

---

## 4. Subscription auth for Claude Code (briefly)

For a *private* Claude Code interface using your own subscription:

- **Before June 15, 2026:** The Claude Code ACP adapter draws from your subscription usage limits same as interactive Claude Code.
- **After June 15:** The adapter wraps the Claude Agent SDK, which Anthropic has explicitly partitioned into a separate "Agent SDK monthly credit" bucket (Pro $20, Max 5x $100, Max 20x $200). Once that's drained, you fall through to pay-as-you-go at API rates. The interactive subscription pool becomes inaccessible from custom frontends.

The subscription's main value — the high interactive rate limits — is reserved post-June-15 for the official Claude Code TUI and IDE extensions.

### tmux-style adapters

The closest existing thing is **`harukitosa/claude-code-acp`** — wraps the `claude` CLI binary directly via subprocess (not tmux specifically, but PTY-style), so it draws on whatever auth Claude Code itself uses. One project, 0 stars, 12 commits, one maintainer.

Treat it as a fragile path. The protocol is open, the implementation is small enough that you could fork it, but there are no good alternatives. Architect on the assumption it might stop working — either because the CLI format drifts or because Anthropic tightens enforcement.

For fleet use, this whole subscription approach is the wrong layer to optimize against. Subscription for personal use; API keys (or DeepSeek via Reasonix) for the fleet.

---

## 5. Why is Reasonix attached to DeepSeek?

The architecture doc states: *"Reasonix is opinionated, not general. Every abstraction is justified by a DeepSeek-specific behavior or economic property. Coupling to one backend is the feature, not a limitation."*

### Technical reasons (real, ~half the answer)

- **`reasoning_content` handling** — used 62 times. Pillar 2 (R1 thought harvesting) is built around it.
- **Pillar 3 tool-call repair** — those four passes (flatten/scavenge/truncation/storm) target empirically observed DeepSeek failure modes.
- **Cache mechanics** — DeepSeek's automatic prefix caching with a 64-token minimum threshold and ~99% discount on hits is the most aggressive prompt caching of any provider. The byte-exact requirement makes more sense when the upside is "99% off" than when it's "25-50% off."
- **Pricing structure** — the flash/pro split only makes sense when you have two tiers of one provider with a big quality/cost gap *and* shared prompt-cache compatibility. OpenRouter has many models but each has its own cache state.

### Post-hoc rationalization (also real, the other half)

The architecture doc protests too much. The honest version would be: "we built this for DeepSeek; multi-provider would require generalizing the loop and we haven't done that work." Both halves of "coupling is the feature" are true, but only the second half is technical — the first is positioning.

### Unstated reasons (context)

- **The maintainer is China-based.** Full bilingual Chinese/English docs, QQ as a remote channel. DeepSeek is a Chinese lab. Claude and OpenAI APIs are difficult to access from mainland China for ordinary developers. From the maintainer's vantage point, "DeepSeek-only" isn't a sacrifice — it's the default.
- **Naming and identity.** The project is literally called "DeepSeek-Reasonix." Going multi-provider dilutes that positioning.
- **The 2.7k stars came from being DeepSeek-specific.** Locally-optimal move is to keep doubling down.
- **Solo-developer project.** Single-maintainer projects tend to make narrow architectural commitments. Saying "we don't do that" is partly genuine conviction and partly self-protection from scope creep.

### Why OpenRouter specifically wouldn't be obvious for them

1. OpenRouter adds a 5-10% margin on every call. Contrary to the cost-minimization pitch.
2. OpenRouter abstracts away provider-specific features the architecture depends on.
3. OpenRouter is US-based. For a Chinese maintainer with Chinese users, adding a US-based payments/routing layer between users and DeepSeek is an anti-feature.

### Read

The technical reasons are real but somewhat oversold; the cultural/incentive reasons are real but not stated. A multi-provider version of the same architecture is buildable; nobody chose to build it, and the people closest to the code had structural reasons not to want to.

---

## 6. Coupling measurement — scale of the rework

Quantitative breakdown for the fork.

### Total codebase

**62,398 LOC** of TypeScript across ~250 files in `src/` (excluding tests).

### Direct DeepSeek coupling

| Coupling type | LOC affected | Notes |
|---|---|---|
| Explicit "DeepSeek" references | 315 lines across 54 files | Names, comments, error matchers |
| Provider-specific API fields (`reasoning_content`, `extra_body`, `prompt_cache_*`) | ~80 lines across 18 files | Mostly in `client.ts`, `tokenizer.ts`, `loop.ts` |
| Hardcoded model IDs (`v4-flash`, `v4-pro`, etc.) | ~52 lines across 17 files | Mostly in pricing, config, presets |
| Class/type names (`DeepSeekClient`) | ~36 references | Mostly imports — rename mechanically |

Adding these up with overlap removed: **roughly 400-450 lines of "true" coupling code** scattered across ~25-30 files.

### Files that actually matter

**Tier 1 — must rewrite (~750-900 LOC):**

- `src/client.ts` (367 LOC, ~21 coupled) — DeepSeek HTTP transport. Roughly 60% generic OpenAI-compat code, 40% DeepSeek-specific. Replace with a provider-abstracted client. **Net new code: ~400-600 LOC.**
- `src/telemetry/stats.ts` (271 LOC, 13 coupled) — Pricing table is hardcoded as a const map. Convert to data-driven pricing fetched from OpenRouter's pricing API or a config file. **Net new code: ~100-150 LOC.**
- `src/tokenizer.ts` (599 LOC, 20 coupled) — Ported DeepSeek V4 tokenizer for context-window math. Swap in `tiktoken` for OpenAI models or accept approximate counts from OpenRouter responses. **~200 LOC of new wrapper.**

**Tier 2 — must edit, but small surgical changes (~150-200 LOC of edits):**

- `src/loop/thinking.ts` (26 LOC, 6 coupled) — Hardcoded model→thinking-mode map. Convert to capability-flags-per-provider.
- `src/loop/healing.ts` (117 LOC, 5 coupled) — Has comments like "DeepSeek 400s on tool_calls missing `id`." The healing logic itself is general but the trigger conditions are DeepSeek-quirk-tuned. Keep most of it, gate the specific fixes behind provider-detection.
- `src/loop/reasoning-retention.ts` (51 LOC, 3 coupled) — Whether to round-trip `reasoning_content` is model-specific. Make this a provider capability.
- `src/loop/errors.ts` (135 LOC, 22 coupled) — Error message parser matches "DeepSeek 401" / "DeepSeek 402" patterns. Generalize to per-provider error mappers.
- `src/repair/scavenge.ts` (201 LOC, 2 coupled) — Pulls tool calls out of `reasoning_content`. The DSML regex patterns (`<｜DSML｜function_calls>`) are DeepSeek R1-specific. Keep the general path, make the model-specific scavengers pluggable.
- `src/config.ts` (1489 LOC, 22 coupled) — Mostly `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` env var references. Mechanical rename with backward-compat aliases. **Maybe 50 LOC of real change.**
- `src/net/proxy.ts` (274 LOC, 18 coupled) — Has a `DEEPSEEK_NO_PROXY` constant for routing around clash/v2ray. Either delete entirely for non-CN users or generalize.
- `src/loop.ts` (1052 LOC, 12 coupled) — Mostly default model string `"deepseek-v4-flash"`. Cosmetic.
- `src/tools/subagent.ts`, `src/context-manager.ts`, `src/code/setup.ts`, `src/prompt-fragments.ts`, `src/code/prompt.ts` — Each has a few hardcoded model strings or flash/pro tier assumptions. Convert to "preset → provider+model" mappings. **Combined: ~50 LOC of edits.**

**Tier 3 — leave alone or rename mechanically:**

- The `repair/` pipeline (588 LOC total) is *almost entirely* model-agnostic. `storm.ts` (66 LOC, 0 coupled), `truncation.ts` (100 LOC, 0 coupled), `index.ts` (129 LOC, 0 coupled), `flatten.ts` (92 LOC, 1 coupled).
- `repair/scavenge.ts` has only ~2 lines of DeepSeek specifics. The reasoning-content-extraction concept generalizes to any reasoning-emitting model.
- `src/loop/dispatch.ts`, `streaming.ts`, `messages.ts`, `shrink.ts`, `force-summary.ts` — zero or near-zero coupling.
- CLI commands (`run.ts`, `acp.ts`, `commit.ts`) reference `DeepSeekClient` by name as a type import. Mechanical rename.
- `i18n/` files (6845 LOC total) contain DeepSeek references in user-facing strings. Update language, no logic changes. **~100 LOC of string edits across three languages.**
- `desktop.ts` (2571 LOC) has only 5 coupled lines — Tauri UI is provider-blind.

### Test surface

**66 of 241 test files (~27%) reference DeepSeek concepts**, ~20,000 LOC of test code. Most are tests that happen to involve a `reasoning_content` field, not tests of DeepSeek-specific behavior. Plan on:

- ~10-20 tests need DeepSeek-specific assertions (DSML envelope parsing, 402-balance error, etc.) — move to a `deepseek-provider.test.ts` suite.
- The rest just need fixtures updated.

Realistic test refactor: **~2,000-3,000 LOC of test updates**, most mechanical.

### Total scale estimate

| Phase | Effort |
|---|---|
| Replace `client.ts` with provider-abstracted version | 400-600 LOC new, weekend project |
| Refactor `tokenizer.ts` to provider-aware wrapper | 200 LOC, half a day |
| Convert pricing to data-driven | 100-150 LOC, a few hours |
| Tier 2 surgical edits across ~10 files | ~200 LOC of edits, day or two |
| Mechanical renames | Trivial with codemod, a few hours |
| i18n string updates | A few hours per language |
| Test suite updates | 2-3 days of dedicated work |
| Integration testing against OpenRouter + a direct provider | A week of poking |

**Realistic total: 1-2 weeks of focused work** for a competent TypeScript developer, producing roughly **1,500-2,500 LOC of net new/changed code** in `src/` plus another **2,000-3,000 LOC of test updates**.

That's about **4-6% of the codebase needs to change**. The remaining 94-96% is genuinely provider-agnostic.

### What this confirms

The "DeepSeek-only by design" framing is largely positioning. The hard architectural work (`ImmutablePrefix`, `AppendOnlyLog`, the repair pipeline, the dispatch logic, ACP, MCP bridging, the UI layer) is provider-blind.

**Upstream sync cost after the fork:** the coupled files are concentrated in ~10 hot-spot files. `client.ts` is the highest-risk file for merge conflicts — plan to manually merge that one every time; everything else should auto-merge.

**Real risk** isn't the rework itself — it's that the maintainer might shift the architecture in a way that breaks your abstraction's assumptions. At 4-6% coupling that's manageable; if it grows to 15-20% over time you'd want to reconsider whether you're forking or just inspired-by.