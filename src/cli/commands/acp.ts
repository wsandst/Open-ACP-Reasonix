/** ACP (Agent Client Protocol) agent — drives the cache-first loop over stdio NDJSON JSON-RPC. */

import { AsyncLocalStorage } from "node:async_hooks";
import { type WriteStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { dispatchKernelEvent } from "../../acp/dispatch.js";
import { requestPermissionForGate } from "../../acp/gates.js";
import {
  ACP_PROTOCOL_VERSION,
  type ContentBlock,
  ERR_INVALID_PARAMS,
  type InitializeParams,
  type InitializeResult,
  type SessionCancelParams,
  type SessionNewParams,
  type SessionNewResult,
  type SessionPromptParams,
  type SessionPromptResult,
  type SessionUpdateParams,
  type StopReason,
  flattenPrompt,
} from "../../acp/protocol.js";
import { AcpServer } from "../../acp/server.js";
import { codeSystemPrompt } from "../../code/prompt.js";
import { buildCodeToolset } from "../../code/setup.js";
import {
  DEFAULT_MODEL,
  type ReasoningEffort,
  bridgeEndpointEnv,
  isReasoningEffort,
  loadApiKey,
  loadEditMode,
  loadEndpoint,
  loadModel,
  loadReasoningEffort,
  normalizeMcpConfig,
  readConfig,
} from "../../config.js";
import { Eventizer } from "../../core/eventize.js";
import { pauseGate } from "../../core/pause-gate.js";
import { autoResolveVerdict } from "../../core/pause-policy.js";
import { loadDotenv } from "../../env.js";
import { t } from "../../i18n/index.js";
import { CacheFirstLoop, ImmutablePrefix } from "../../index.js";
import { createLLMClient } from "../../llm-factory.js";
import { McpClient } from "../../mcp/client.js";
import { loadDotMcpJson } from "../../mcp/dot-mcp-json.js";
import { formatMcpLifecycleEvent } from "../../mcp/format/lifecycle.js";
import { formatMcpSlowToast } from "../../mcp/format/slow-toast.js";
import { preflightStdioSpec } from "../../mcp/preflight.js";
import { bridgeMcpTools } from "../../mcp/registry.js";
import { buildTransportFromSpec } from "../../mcp/transport-from-spec.js";
import { timestampSuffix } from "../../memory/session.js";
import { openTranscriptFile, recordFromLoopEvent, writeRecord } from "../../transcript/log.js";
import { VERSION } from "../../version.js";

export interface AcpOptions {
  model?: string;
  /** Reasoning effort for every session this server spawns (low|medium|high|max).
   * Overrides the config-file value; invalid values fall back to it. */
  effort?: string;
  dir?: string;
  budgetUsd?: number;
  transcript?: string;
  yolo?: boolean;
  /** Zero or more MCP server specs. Each: `"name=cmd args..."` or `"cmd args..."`. */
  mcpSpecs?: string[];
  /** Global prefix — only honored when a single anonymous server is given. */
  mcpPrefix?: string;
}

interface Session {
  id: string;
  rootDir: string;
  model: string;
  toolset: Awaited<ReturnType<typeof buildCodeToolset>>;
  mcpClients: McpClient[];
  loop: CacheFirstLoop;
  eventizer: Eventizer;
  ctx: {
    model: string;
    prefixHash: string;
    reasoningEffort: import("../../config.js").ReasoningEffort;
  };
  aborter: AbortController | null;
}

function resolveMcpPrefix(
  specName: string | null | undefined,
  specCount: number,
  globalPrefix: string | undefined,
): string {
  if (specName) return `${specName}_`;
  if (specCount === 1 && globalPrefix) return globalPrefix;
  return "";
}

// Mirrors run.ts:81-142.
export async function loadMcpServers(
  tools: import("../../tools.js").ToolRegistry,
  specs: string[],
  globalPrefix: string | undefined,
  workspaceDir: string = process.cwd(),
): Promise<McpClient[]> {
  const clients: McpClient[] = [];
  const cfg = readConfig();
  // Merge a project-level .mcp.json (Claude-style `mcpServers`) into the config
  // so HTTP servers WITH auth headers can be declared per-workspace. This is the
  // only way to reach a server behind an auth gateway: the `--mcp` CLI spec
  // carries a URL but no headers, whereas an mcpServers entry carries both.
  const dotMcp = loadDotMcpJson(workspaceDir);
  if (dotMcp) {
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}), ...dotMcp };
  }
  const normalizedSpecs = normalizeMcpConfig(cfg, specs);
  if (normalizedSpecs.length === 0) return clients;
  for (const spec of normalizedSpecs) {
    let label = "anon";
    let mcp: McpClient | undefined;
    try {
      label = spec.name ?? "anon";
      if (spec.disabled) {
        process.stderr.write(`${formatMcpLifecycleEvent({ state: "disabled", name: label })}\n`);
        continue;
      }
      process.stderr.write(`${formatMcpLifecycleEvent({ state: "handshake", name: label })}\n`);
      const t0 = Date.now();
      const prefix = resolveMcpPrefix(spec.name, normalizedSpecs.length, globalPrefix);
      if (spec.transport === "stdio") preflightStdioSpec(spec);
      const transport = buildTransportFromSpec(spec, { cwd: workspaceDir });
      mcp = new McpClient({ transport, workspaceDir });
      await mcp.initialize();
      const bridge = await bridgeMcpTools(mcp, {
        registry: tools,
        namePrefix: prefix,
        serverName: label,
        onSlow: (info) =>
          process.stderr.write(
            `${formatMcpSlowToast({ name: info.serverName, p95Ms: info.p95Ms, sampleSize: info.sampleSize })}\n`,
          ),
      });
      process.stderr.write(
        `${formatMcpLifecycleEvent({
          state: "connected",
          name: label,
          tools: bridge.registeredNames.length,
          ms: Date.now() - t0,
        })}\n`,
      );
      clients.push(mcp);
    } catch (err) {
      await mcp?.close().catch(() => undefined);
      process.stderr.write(
        `${formatMcpLifecycleEvent({ state: "failed", name: label, reason: (err as Error).message })}\n  → ${t("mcpLifecycle.failedSetupConfigHint")}\n`,
      );
    }
  }
  return clients;
}

function resolveDir(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const abs = resolve(raw);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`workspace directory not found: ${abs}`);
  }
  return abs;
}

/** Built-in tool names the host asked to drop, from REASONIX_DISABLE_TOOLS
 * (comma/whitespace-separated). Empty when unset — the fork ships the full
 * toolset by default; embedders opt out of specific tools. */
export function disabledToolNamesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.REASONIX_DISABLE_TOOLS;
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function buildSession(opts: {
  rootDir: string;
  modelOverride?: string;
  effortOverride?: string;
  budgetUsd?: number;
  mcpSpecs?: string[];
  mcpPrefix?: string;
  systemAppend?: string;
}): Promise<Session> {
  const model = opts.modelOverride || loadModel() || DEFAULT_MODEL;
  const effort = resolveEffort(opts.effortOverride);
  const toolset = await buildCodeToolset({ rootDir: opts.rootDir });
  // Drop unwanted built-ins BEFORE bridging MCP / building the prefix so their
  // specs stay out of the cache key and the model never sees them. Host-driven
  // via REASONIX_DISABLE_TOOLS (comma-separated). Used by embedders that own a
  // capability elsewhere (e.g. an external memory store) or run headless where
  // an interactive tool (ask_choice) has no operator to answer it.
  for (const name of disabledToolNamesFromEnv()) {
    if (toolset.tools.unregister(name)) {
      process.stderr.write(`reasonix: disabled built-in tool "${name}" (REASONIX_DISABLE_TOOLS)\n`);
    }
  }
  // Bridge MCP tools BEFORE building the prefix so their specs make it into the cache key.
  const mcpClients = await loadMcpServers(
    toolset.tools,
    opts.mcpSpecs ?? [],
    opts.mcpPrefix,
    opts.rootDir,
  );
  const system = codeSystemPrompt(opts.rootDir, {
    hasSemanticSearch: toolset.semantic.enabled,
    modelId: model,
    systemAppend: opts.systemAppend,
  });
  const ep = loadEndpoint();
  const client = createLLMClient(ep);
  const prefix = new ImmutablePrefix({ system, toolSpecs: toolset.tools.specs() });
  const loop = new CacheFirstLoop({
    client,
    prefix,
    tools: toolset.tools,
    model,
    // Without this the loop silently ran at its own internal default ("high")
    // and ignored both the config file and any host override.
    reasoningEffort: effort,
    budgetUsd: opts.budgetUsd,
    session: `acp-${timestampSuffix()}`,
  });
  return {
    id: `sess_${timestampSuffix()}-${Math.random().toString(36).slice(2, 8)}`,
    rootDir: opts.rootDir,
    model,
    toolset,
    mcpClients,
    loop,
    eventizer: new Eventizer(),
    ctx: {
      model,
      prefixHash: prefix.fingerprint,
      reasoningEffort: effort,
    },
    aborter: null,
  };
}

/** The session's reasoning effort: a valid `--effort` flag wins; anything else
 * (unset / typo) falls back to the config file (which itself defaults "high"). */
export function resolveEffort(override: string | undefined): ReasoningEffort {
  if (isReasoningEffort(override)) return override;
  if (override) {
    process.stderr.write(
      `reasonix: ignoring invalid --effort "${override}" (want low|medium|high|max)\n`,
    );
  }
  return loadReasoningEffort();
}

export async function acpCommand(opts: AcpOptions): Promise<void> {
  loadDotenv();
  bridgeEndpointEnv();

  const defaultDir = resolveDir(opts.dir, process.cwd());
  const sessions = new Map<string, Session>();
  const sessionContext = new AsyncLocalStorage<{ sessionId: string; sourceTurnId?: string }>();
  const server = new AcpServer();

  let transcriptStream: WriteStream | null = null;
  if (opts.transcript) {
    const defaultModel = opts.model || loadModel() || DEFAULT_MODEL;
    transcriptStream = openTranscriptFile(opts.transcript, {
      version: 1,
      source: "reasonix acp",
      model: defaultModel,
      startedAt: new Date().toISOString(),
    });
  }

  pauseGate.on((req) => {
    const editMode = opts.yolo ? "yolo" : loadEditMode();
    const auto = autoResolveVerdict(req, editMode);
    if (auto !== null) {
      pauseGate.resolve(req.id, auto);
      return;
    }
    const activeContext = sessionContext.getStore();
    if (!activeContext || !sessions.has(activeContext.sessionId)) {
      pauseGate.cancel(req.id);
      return;
    }
    void (async () => {
      const verdict = await requestPermissionForGate(server, activeContext.sessionId, req);
      pauseGate.resolve(req.id, verdict);
    })();
  });

  server.onRequest<InitializeParams, InitializeResult>("initialize", (params) => {
    if (!params || typeof params !== "object") {
      throw Object.assign(new Error("initialize: missing params"), { code: ERR_INVALID_PARAMS });
    }
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
        mcpCapabilities: { http: false, sse: false },
      },
      agentInfo: { name: "reasonix", title: "Reasonix", version: VERSION },
      authMethods: [],
    };
  });

  server.onRequest<SessionNewParams, SessionNewResult>("session/new", async (params) => {
    const rootDir = resolveDir(params?.cwd, defaultDir);
    const session = await buildSession({
      rootDir,
      modelOverride: opts.model,
      effortOverride: opts.effort,
      budgetUsd: opts.budgetUsd,
      mcpSpecs: opts.mcpSpecs,
      mcpPrefix: opts.mcpPrefix,
      systemAppend: process.env.REASONIX_ACP_SYSTEM_APPEND || undefined,
    });
    sessions.set(session.id, session);
    return { sessionId: session.id };
  });

  server.onRequest<SessionPromptParams, SessionPromptResult>("session/prompt", async (params) => {
    if (!params?.sessionId) {
      throw Object.assign(new Error("session/prompt: missing sessionId"), {
        code: ERR_INVALID_PARAMS,
      });
    }
    const session = sessions.get(params.sessionId);
    if (!session) {
      throw Object.assign(new Error(`session/prompt: unknown session ${params.sessionId}`), {
        code: ERR_INVALID_PARAMS,
      });
    }
    const text = flattenPrompt(params.prompt as ContentBlock[]);
    if (!text) {
      throw Object.assign(new Error("session/prompt: empty prompt"), { code: ERR_INVALID_PARAMS });
    }
    session.aborter = new AbortController();
    let stopReason: StopReason = "end_turn";
    try {
      await sessionContext.run({ sessionId: session.id, sourceTurnId: params.sourceTurnId }, async () => {
        for await (const ev of session.loop.step(text)) {
          if (session.aborter?.signal.aborted) {
            stopReason = "cancelled";
            break;
          }
          // transcript needs raw LoopEvent (usage/cost/stats); kernel events lose those fields
          if (transcriptStream) {
            writeRecord(
              transcriptStream,
              recordFromLoopEvent(ev, {
                model: session.ctx.model,
                prefixHash: session.ctx.prefixHash,
              }),
            );
          }
          for (const kev of session.eventizer.consume(ev, session.ctx)) {
            // Keep the prompt's immutable async context through delayed model.final
            // notifications; never derive attribution from a mutable active turn.
            dispatchKernelEvent(server, session.id, kev, sessionContext.getStore()?.sourceTurnId);
            if (kev.type === "error") stopReason = "error";
          }
        }
      });
    } catch (err) {
      const message = (err as Error).message;
      server.sendNotification("session/update", {
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `\n\n[error] ${message}` },
        },
      } satisfies SessionUpdateParams);
      stopReason = "error";
    } finally {
      session.aborter = null;
    }
    return { stopReason };
  });

  server.onNotification<SessionCancelParams>("session/cancel", (params) => {
    const session = params?.sessionId ? sessions.get(params.sessionId) : undefined;
    session?.aborter?.abort();
  });

  try {
    await server.done();
  } finally {
    transcriptStream?.end();
    // Tear down MCP children so spawned servers don't outlive the agent.
    const closes: Promise<unknown>[] = [];
    for (const session of sessions.values()) {
      for (const mcp of session.mcpClients) {
        closes.push(mcp.close().catch(() => undefined));
      }
    }
    await Promise.all(closes);
  }
}
