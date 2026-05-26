/** Open-ACP-Reasonix CLI — minimal launcher. The fork is ACP-first; the only
 *  long-running command is `acp`, plus a few one-shot diagnostics. */

import { Command } from "commander";
import { loadProxyConfig } from "../config.js";
import { VERSION } from "../index.js";
import { installProxyIfConfigured } from "../net/proxy.js";

// HTTPS_PROXY / HTTP_PROXY only reach Node's fetch via undici's global dispatcher;
// install before any LLMClient constructs a fetch closure.
const cliNoProxy = process.argv.includes("--no-proxy");
const cfgProxy = loadProxyConfig();
installProxyIfConfigured(process.env, {
  disabled: cliNoProxy || cfgProxy.disabled === true,
  url: cfgProxy.url,
  extraNoProxy: cfgProxy.noProxy,
  bypassDeepSeekDirect: cfgProxy.bypassDeepSeekDirect,
});

function parseBudgetFlag(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw <= 0) {
    process.stderr.write(
      `▲ ignoring --budget=${raw} (must be a positive number) — running with no cap\n`,
    );
    return undefined;
  }
  return raw;
}

const program = new Command();
program
  .name("reasonix")
  .description("Open-ACP-Reasonix — ACP-native agent backend over OpenRouter / DeepSeek")
  .version(VERSION)
  .option("--no-proxy", "ignore HTTPS_PROXY / HTTP_PROXY env vars for this run");

program
  .command("acp")
  .description("speak Agent Client Protocol (JSON-RPC) over stdio")
  .option("-m, --model <id>", "override the default model id")
  .option("--dir <path>", "root directory for filesystem tools (default: cwd)")
  .option("--transcript <path>", "append every loop event as JSONL for replay/debug")
  .option("--budget <usd>", "soft cap; warn at 80%, refuse at 100%", (v) => Number.parseFloat(v))
  .option("--yolo", "skip tool-confirmation gates (use only in sandboxed contexts)")
  .option(
    "--mcp <spec>",
    "MCP server spec; repeat for multiple",
    (value: string, previous: string[] = []) => [...previous, value],
    [] as string[],
  )
  .option("--mcp-prefix <str>", "prefix for tools from a single anonymous MCP server")
  .action(async (opts) => {
    const { acpCommand } = await import("./commands/acp.js");
    await acpCommand({
      model: opts.model,
      dir: opts.dir,
      transcript: opts.transcript,
      budgetUsd: parseBudgetFlag(opts.budget),
      yolo: !!opts.yolo,
      mcpSpecs: opts.mcp,
      mcpPrefix: opts.mcpPrefix,
    });
  });

program
  .command("doctor")
  .description("self-diagnostic: prints config / endpoint / tokenizer / sessions status")
  .option("--json", "emit machine-readable JSON instead of the human-readable table")
  .action(async (opts) => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand({ json: !!opts.json });
  });

program
  .command("mcp-inspect <spec>")
  .description("probe an MCP server spec and report tools/resources/prompts")
  .action(async (spec: string) => {
    const { mcpInspectCommand } = await import("./commands/mcp-inspect.js");
    await mcpInspectCommand({ spec });
  });

program
  .command("index")
  .description("build or refresh the semantic search index (Ollama / OpenAI-compat embeddings)")
  .option("--rebuild", "ignore the existing index and start fresh")
  .option("-m, --model <id>", "override the embedding model id")
  .option("--dir <path>", "project root to index (default: cwd)")
  .option("--ollama-url <url>", "override the Ollama base URL")
  .option("-y, --yes", "skip interactive confirmation prompts")
  .action(async (opts) => {
    const { indexCommand } = await import("./commands/index.js");
    await indexCommand({
      rebuild: !!opts.rebuild,
      model: opts.model,
      dir: opts.dir,
      ollamaUrl: opts.ollamaUrl,
      yes: !!opts.yes,
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message ?? String(err)}\n`);
  process.exit(1);
});
