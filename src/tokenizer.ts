/** Token counting via tiktoken. Provider-agnostic: defaults to o200k_base
 *  (modern OpenAI / gpt-4o / gpt-5 + ~10% drift on Claude/Gemini). */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Tiktoken, get_encoding } from "tiktoken";
import { LruCache } from "./core/lru.js";

type EncodingName = "o200k_base" | "cl100k_base";

const DEFAULT_ENCODING: EncodingName = "o200k_base";

const encoderCache = new Map<EncodingName, Tiktoken>();

function getEncoder(name: EncodingName = DEFAULT_ENCODING): Tiktoken {
  const hit = encoderCache.get(name);
  if (hit) return hit;
  const enc = get_encoding(name);
  encoderCache.set(name, enc);
  return enc;
}

/** Best-effort model → tiktoken encoding mapping. Most modern OpenAI models use
 *  o200k_base; older gpt-4 / gpt-3.5 use cl100k_base. Non-OpenAI providers fall
 *  through to the default — within 5-15% of the real count, fine for budgeting. */
export function encodingForModel(model: string | undefined): EncodingName {
  if (!model) return DEFAULT_ENCODING;
  const lower = model.toLowerCase();
  // Strip `vendor/` prefix that OpenRouter uses.
  const bare = lower.includes("/") ? lower.split("/").pop()! : lower;
  if (bare.startsWith("gpt-4o") || bare.startsWith("gpt-5")) return "o200k_base";
  if (bare.startsWith("o1") || bare.startsWith("o3") || bare.startsWith("o4")) return "o200k_base";
  if (bare.startsWith("gpt-4") || bare.startsWith("gpt-3")) return "cl100k_base";
  return DEFAULT_ENCODING;
}

/** Returns the on-disk location of the tiktoken package — doctor reports it as
 *  evidence the tokenizer is wired up. Equivalent to the old gzipped JSON path. */
export function resolveDataPath(): string {
  if (process.env.REASONIX_TOKENIZER_PATH) return process.env.REASONIX_TOKENIZER_PATH;
  const candidates: string[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "..", "node_modules", "tiktoken"));
    candidates.push(join(here, "..", "..", "node_modules", "tiktoken"));
  } catch {
    /* import.meta.url unavailable */
  }
  try {
    const req = createRequire(import.meta.url);
    candidates.push(dirname(req.resolve("tiktoken/package.json")));
  } catch {
    /* tiktoken unresolvable — first candidate is returned as-is so doctor reports a useful path */
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] ?? "tiktoken";
}

/** Eager-instantiate the default encoder so the first real countTokens() call
 *  doesn't pay the WASM-init cost mid-turn. Safe to call multiple times. */
export function warmupTokenizer(): void {
  getEncoder(DEFAULT_ENCODING);
}

export function encode(text: string, model?: string): number[] {
  if (!text) return [];
  return Array.from(getEncoder(encodingForModel(model)).encode(text));
}

export function countTokens(text: string, model?: string): number {
  if (!text) return 0;
  return getEncoder(encodingForModel(model)).encode(text).length;
}

export const DEFAULT_BOUNDED_TOKENIZE_CHARS = 2 * 1024;

export function countTokensBounded(
  text: string,
  maxChars = DEFAULT_BOUNDED_TOKENIZE_CHARS,
  model?: string,
): number {
  if (text.length === 0) return 0;
  const cap = Math.floor(maxChars);
  if (cap > 0 && text.length <= cap) return countTokens(text, model);
  if (cap <= 0) return Math.max(1, Math.ceil(text.length * 0.3));

  const headChars = Math.ceil(cap / 2);
  const tailChars = Math.floor(cap / 2);
  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(-tailChars) : "";
  const sampleChars = head.length + tail.length;
  const sampleTokens = countTokens(head, model) + countTokens(tail, model);
  const ratio = sampleChars > 0 ? sampleTokens / sampleChars : 0.3;
  return Math.max(1, Math.ceil(text.length * ratio));
}

/** OpenAI chat-completion per-message envelope overhead (role + delimiters);
 *  4 tracks the public OpenAI reference value for cl100k_base / o200k_base. */
const PER_MESSAGE_TEMPLATE_TOKENS = 4;

const contentTokenCache = new LruCache<string, number>(4096);

function cachedBoundedTokens(s: string): number {
  if (s.length === 0) return 0;
  const cached = contentTokenCache.get(s);
  if (cached !== undefined) return cached;
  const n = countTokensBounded(s);
  contentTokenCache.set(s, n);
  return n;
}

interface EstimableMessage {
  role?: string;
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  reasoning_content?: string | null;
}

function tokensForMessage(m: EstimableMessage, dropThisReasoning: boolean): number {
  let n = 0;
  if (typeof m.content === "string" && m.content.length > 0) {
    n += cachedBoundedTokens(m.content);
  }
  if (m.role === "assistant") {
    if (
      !dropThisReasoning &&
      typeof m.reasoning_content === "string" &&
      m.reasoning_content.length > 0
    ) {
      n += cachedBoundedTokens(m.reasoning_content);
    }
    const tcs = m.tool_calls;
    if (Array.isArray(tcs) && tcs.length > 0) {
      n += cachedBoundedTokens(JSON.stringify(tcs));
    }
  }
  return n;
}

/** Per-message bounded sum, not a full-prompt rebuild — within ±5% of API truth,
 *  fine for fold-threshold checks where the next API call returns the real count. */
export function estimateConversationTokens(
  messages: EstimableMessage[],
  drop_thinking = false,
): number {
  if (messages.length === 0) return 0;
  let lastUserOrDev = -1;
  if (drop_thinking) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const r = messages[i]!.role;
      if (r === "user" || r === "developer") {
        lastUserOrDev = i;
        break;
      }
    }
  }
  let total = 2;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (drop_thinking && i < lastUserOrDev && m.role === "developer") continue;
    total += PER_MESSAGE_TEMPLATE_TOKENS;
    const dropReasoning = drop_thinking && i < lastUserOrDev && m.role === "assistant";
    total += tokensForMessage(m, dropReasoning);
  }
  return total;
}

/** Total request tokens (messages + tool specs). Tool specs are stringified
 *  JSON; OpenAI's tool descriptions live in the request body the same way. */
export function estimateRequestTokens(
  messages: EstimableMessage[],
  toolSpecs?: ReadonlyArray<unknown> | null,
  drop_thinking = false,
): number {
  let total = estimateConversationTokens(messages, drop_thinking);
  if (toolSpecs && toolSpecs.length > 0) {
    total += countTokensBounded(JSON.stringify(toolSpecs));
  }
  return total;
}

/** Exposed for tests — frees the WASM encoder handles. */
export function _resetForTests(): void {
  for (const enc of encoderCache.values()) {
    try {
      enc.free();
    } catch {
      /* freed already */
    }
  }
  encoderCache.clear();
  contentTokenCache.clear();
}
