/** OpenRouter chat-completions transport. OpenAI-compatible REST surface with a
 *  few provider-specific quirks (reasoning emitted on `delta.reasoning` instead
 *  of `delta.reasoning_content`; cached prompt tokens reported as nested
 *  `prompt_tokens_details.cached_tokens`; credits exposed under `/credits` not
 *  `/user/balance`).
 *
 *  Implements LLMClient so the loop / subagent code stays provider-agnostic. */

import { type EventSourceMessage, createParser } from "eventsource-parser";
import type {
  BalanceInfo,
  ChatResponse,
  LLMClient,
  ModelList,
  StreamChunk,
  UserBalance,
} from "./client.js";
import { Usage } from "./client.js";
import { loadRateLimit } from "./config.js";
import { type RetryOptions, fetchWithRetry } from "./retry.js";
import type { ChatRequestOptions } from "./types.js";

export interface OpenRouterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  rateLimit?: { rpm?: number };
  retry?: RetryOptions;
  /** Sent as the `HTTP-Referer` header — appears on OpenRouter's app leaderboard. */
  referer?: string;
  /** Sent as the `X-Title` header — display name on OpenRouter's app leaderboard. */
  appTitle?: string;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_APP_TITLE = "Reasonix";

export class OpenRouterClient implements LLMClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly retry: RetryOptions;
  readonly referer: string | undefined;
  readonly appTitle: string;
  private readonly _fetch: typeof fetch;
  private readonly minChatIntervalMs: number;
  private nextChatRequestAt = 0;

  constructor(opts: OpenRouterClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set. Put it in .env or pass apiKey to OpenRouterClient.",
      );
    }
    this.apiKey = apiKey;
    let url =
      opts.baseUrl ??
      process.env.OPENROUTER_BASE_URL ??
      process.env.OPENROUTER_API_BASE_URL ??
      DEFAULT_BASE_URL;
    while (url.endsWith("/")) url = url.slice(0, -1);
    this.baseUrl = url;
    this.timeoutMs = opts.timeoutMs ?? 660_000;
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.retry = opts.retry ?? {};
    this.referer = opts.referer ?? process.env.OPENROUTER_REFERER ?? undefined;
    this.appTitle = opts.appTitle ?? process.env.OPENROUTER_APP_TITLE ?? DEFAULT_APP_TITLE;
    const rpm = opts.rateLimit?.rpm ?? loadRateLimit()?.rpm;
    this.minChatIntervalMs = rpm ? Math.ceil(60_000 / rpm) : 0;
  }

  private async waitForChatRateLimit(signal?: AbortSignal): Promise<void> {
    if (this.minChatIntervalMs <= 0) return;
    const now = Date.now();
    const waitMs = Math.max(0, this.nextChatRequestAt - now);
    this.nextChatRequestAt = Math.max(now, this.nextChatRequestAt) + this.minChatIntervalMs;
    if (waitMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "X-Title": this.appTitle,
      ...extra,
    };
    if (this.referer) h["HTTP-Referer"] = this.referer;
    return h;
  }

  private buildPayload(opts: ChatRequestOptions, stream: boolean) {
    const payload: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      stream,
    };
    if (opts.tools?.length) payload.tools = opts.tools;
    if (opts.temperature !== undefined) payload.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) payload.max_tokens = opts.maxTokens;
    if (opts.responseFormat) payload.response_format = opts.responseFormat;
    // OpenRouter exposes a unified `reasoning` knob that maps to each provider's
    // native thinking control (OpenAI o-series `reasoning_effort`, Anthropic
    // extended thinking, DeepSeek's extra_body.thinking, etc.). Prefer it over
    // sending provider-specific fields.
    const reasoning: Record<string, unknown> = {};
    if (opts.reasoningEffort) reasoning.effort = opts.reasoningEffort;
    if (opts.thinking === "disabled") reasoning.exclude = true;
    if (Object.keys(reasoning).length > 0) payload.reasoning = reasoning;
    if (stream) {
      // Without this OpenRouter omits the usage object on the final SSE frame.
      payload.usage = { include: true };
    }
    return payload;
  }

  /** OpenRouter exposes credits at /credits as `{ data: { total_credits, total_usage } }`.
   *  Normalize to the UserBalance shape so the doctor/probe code doesn't fork. */
  async getBalance(opts: { signal?: AbortSignal } = {}): Promise<UserBalance | null> {
    try {
      const resp = await this._fetch(`${this.baseUrl}/credits`, {
        method: "GET",
        headers: this.headers(),
        signal: opts.signal,
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as {
        data?: { total_credits?: number; total_usage?: number };
      };
      const data = json.data;
      if (!data || typeof data.total_credits !== "number") return null;
      const used = typeof data.total_usage === "number" ? data.total_usage : 0;
      const remaining = Math.max(0, data.total_credits - used);
      const info: BalanceInfo = {
        currency: "USD",
        total_balance: remaining.toFixed(2),
        granted_balance: data.total_credits.toFixed(2),
      };
      return { is_available: remaining > 0, balance_infos: [info] };
    } catch {
      return null;
    }
  }

  async listModels(opts: { signal?: AbortSignal } = {}): Promise<ModelList | null> {
    try {
      const resp = await this._fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.headers(),
        signal: opts.signal,
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as ModelList;
      if (!data || !Array.isArray(data.data)) return null;
      return data;
    } catch {
      return null;
    }
  }

  async chat(opts: ChatRequestOptions): Promise<ChatResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error(`OpenRouter request timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );
    const signal = opts.signal ? AbortSignal.any([opts.signal, ctrl.signal]) : ctrl.signal;

    try {
      await this.waitForChatRateLimit(signal);
      const resp = await fetchWithRetry(
        this._fetch,
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(this.buildPayload(opts, false)),
          signal,
        },
        { ...this.retry, signal },
      );
      if (!resp.ok) {
        throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
      }
      const data: any = await resp.json();
      const choice = data.choices?.[0]?.message ?? {};
      // OpenRouter mirrors the unified `reasoning` field; older clients may also
      // see `reasoning_content` round-tripped from the provider — accept both.
      const reasoningContent =
        typeof choice.reasoning === "string"
          ? choice.reasoning
          : typeof choice.reasoning_content === "string"
            ? choice.reasoning_content
            : null;
      return {
        content: choice.content ?? "",
        reasoningContent,
        toolCalls: choice.tool_calls ?? [],
        usage: Usage.fromApi(data.usage ?? data),
        raw: data,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async *stream(opts: ChatRequestOptions): AsyncGenerator<StreamChunk> {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error(`OpenRouter stream timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );
    const signal = opts.signal ? AbortSignal.any([opts.signal, ctrl.signal]) : ctrl.signal;

    let resp: Response;
    try {
      await this.waitForChatRateLimit(signal);
      resp = await fetchWithRetry(
        this._fetch,
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: this.headers({
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          }),
          body: JSON.stringify(this.buildPayload(opts, true)),
          signal,
        },
        { ...this.retry, signal },
      );
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
    if (!resp.ok || !resp.body) {
      clearTimeout(timer);
      throw new Error(`OpenRouter ${resp.status}: ${await resp.text().catch(() => "")}`);
    }

    const queue: StreamChunk[] = [];
    let done = false;
    const parser = createParser({
      onEvent: (ev: EventSourceMessage) => {
        if (!ev.data || ev.data === "[DONE]") {
          done = true;
          return;
        }
        try {
          const json = JSON.parse(ev.data);
          const delta = json.choices?.[0]?.delta ?? {};
          const finishReason = json.choices?.[0]?.finish_reason ?? undefined;
          const chunk: StreamChunk = { raw: json, finishReason };
          if (typeof delta.content === "string" && delta.content.length > 0) {
            chunk.contentDelta = delta.content;
          }
          // OpenRouter streams reasoning as `delta.reasoning`; some providers may
          // forward `delta.reasoning_content` instead — keep both paths so we
          // never miss CoT.
          const reasoningDelta =
            typeof delta.reasoning === "string" && delta.reasoning.length > 0
              ? delta.reasoning
              : typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0
                ? delta.reasoning_content
                : null;
          if (reasoningDelta) chunk.reasoningDelta = reasoningDelta;
          if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
            const tc = delta.tool_calls[0];
            chunk.toolCallDelta = {
              index: tc.index ?? 0,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            };
          }
          const rawUsage = json.usage ?? (Usage.hasApiUsage(json) ? json : undefined);
          if (rawUsage) {
            chunk.usage = Usage.fromApi(rawUsage);
          }
          queue.push(chunk);
        } catch {
          /* skip malformed sse frame */
        }
      },
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (done) break;
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      while (queue.length > 0) yield queue.shift()!;
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }
}
