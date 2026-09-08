/** Map kernel events (model.delta / tool.preparing|intent|result) to ACP session/update notifications. */

import { toolKindFor } from "@reasonix/core-utils";
import type { Event as KernelEvent } from "../core/events.js";
import type { SessionUpdateParams } from "./protocol.js";
import type { AcpServer } from "./server.js";
export { toolKindFor } from "@reasonix/core-utils";
export type { AcpToolKind } from "@reasonix/core-utils";

function tryParseJson(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Stateless mapping from one kernel event to (zero or more) ACP session/update notifications. */
export function dispatchKernelEvent(
  server: AcpServer,
  sessionId: string,
  ev: KernelEvent,
  sourceTurnId?: string,
): void {
  switch (ev.type) {
    case "model.delta": {
      if (!ev.text) return;
      const variant = ev.channel === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk";
      emit(server, {
        sessionId,
        update: { sessionUpdate: variant, content: { type: "text", text: ev.text } },
      });
      return;
    }
    case "tool.preparing": {
      emit(server, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: ev.callId,
          title: ev.name,
          kind: toolKindFor(ev.name),
          status: "pending",
        },
      });
      return;
    }
    case "tool.intent": {
      emit(server, {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: ev.callId,
          status: "in_progress",
        },
      });
      const rawInput = tryParseJson(ev.args);
      if (rawInput !== undefined) {
        emit(server, {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: ev.callId,
            title: ev.name,
            kind: toolKindFor(ev.name),
            status: "in_progress",
            rawInput,
          },
        });
      }
      return;
    }
    case "tool.result": {
      emit(server, {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: ev.callId,
          status: ev.ok ? "completed" : "failed",
          content: [
            {
              type: "content",
              content: { type: "text", text: clip(ev.output) },
            },
          ],
        },
      });
      return;
    }
    case "model.final": {
      const u = ev.usage ?? {};
      const promptTokens = u.prompt_tokens ?? 0;
      const completionTokens = u.completion_tokens ?? 0;
      const costUsd = ev.costUsd ?? 0;
      // Skip empty wrap-up turns (no stats) so clients don't see zero rows.
      if (promptTokens === 0 && completionTokens === 0 && costUsd === 0) return;
      emit(server, {
        sessionId,
        update: {
          sessionUpdate: "usage",
          ...(sourceTurnId ? { sourceTurnId } : {}),
          model: ev.model,
          promptTokens,
          completionTokens,
          totalTokens: u.total_tokens ?? promptTokens + completionTokens,
          promptCacheHitTokens: u.prompt_cache_hit_tokens ?? 0,
          promptCacheMissTokens: u.prompt_cache_miss_tokens ?? 0,
          costUsd,
          sessionTurns: ev.sessionTurns ?? 0,
          sessionCostUsd: ev.sessionCostUsd ?? costUsd,
        },
      });
      return;
    }
    default:
      return;
  }
}

const MAX_RESULT_CHARS = 8000;
function clip(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n…(${text.length - MAX_RESULT_CHARS} more chars truncated)`;
}

function emit(server: AcpServer, params: SessionUpdateParams): void {
  server.sendNotification("session/update", params);
}
