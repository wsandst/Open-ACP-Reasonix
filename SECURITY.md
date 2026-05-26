# Security Policy

If you find a security issue in **Open-ACP-Reasonix**, please report it privately
rather than opening a public issue or discussion thread.

## How to report

Email <william.sandstroem@gmail.com> with:

- a clear description of the issue
- steps that reproduce it (a minimal repro is fine)
- the version (`reasonix --version`) and platform you observed it on

You'll get an acknowledgement within a few days, and a fix or mitigation as
soon as it can land. Attribution in the release notes is on request.

## Where the issue might actually live

This fork sits on top of [esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix).
The agent loop, MCP transports, edit gate, ACP server, repair pipeline, memory
model, sessions, hooks, and tools are upstream code; only the provider
abstraction (`src/client.ts`, `src/openrouter.ts`, `src/llm-factory.ts`),
tokenizer (`src/tokenizer.ts`), pricing cache
(`src/telemetry/pricing-cache.ts`), and trimmed CLI (`src/cli/`) are
fork-specific. For issues that clearly originate upstream, please also notify
the upstream project so the fix lands at the source.

## Supported versions

Only the latest release is supported. Older versions get no backports.

## Scope

**In scope:**

- The published `open-acp-reasonix` package and its `acp` / `doctor` /
  `mcp-inspect` CLI surfaces
- The shell sandbox, edit gate, and tool dispatcher
- The ACP protocol handlers in `src/acp/`

**Out of scope:**

- Third-party MCP servers attached via `--mcp` (report to those projects)
- Misconfiguration of the user's own API key, environment, or shell profile
- Vulnerabilities in upstream Node.js, OpenRouter, or the DeepSeek API itself

## Hardening notes

- API keys live in `~/.reasonix/config.json`. Treat that file like any other
  credential store.
- The `run_command` tool respects a permission allowlist; the safe default is
  `ask` on anything not pre-approved. Don't pass `--yolo` on machines that
  hold secrets you'd regret leaking.
- Hooks execute arbitrary shell scripts the user has configured. Audit
  `.reasonix/settings.json` before running the binary in a directory you
  didn't author.
