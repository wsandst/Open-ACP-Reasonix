import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const initializeMock = vi.fn(async () => undefined);
  const closeMock = vi.fn(async () => undefined);
  const bridgeMock = vi.fn(async (_client: unknown, opts: { namePrefix?: string }) => ({
    registeredNames: [`${opts.namePrefix ?? ""}echo`],
  }));
  const preflightMock = vi.fn(() => undefined);
  const readConfigMock = vi.fn(() => ({ mcpDisabled: [] as string[] }));

  class FakeMcpClient {
    async initialize() {
      return initializeMock();
    }
    async close() {
      return closeMock();
    }
  }
  class FakeTransport {}
  return {
    initializeMock,
    closeMock,
    bridgeMock,
    preflightMock,
    readConfigMock,
    FakeMcpClient,
    FakeTransport,
  };
});

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    readConfig: mocks.readConfigMock,
    mcpEnvFor: () => ({}),
  };
});

vi.mock("../src/mcp/client.js", () => ({
  McpClient: mocks.FakeMcpClient,
}));

vi.mock("../src/mcp/registry.js", () => ({
  bridgeMcpTools: mocks.bridgeMock,
}));

vi.mock("../src/mcp/preflight.js", () => ({
  preflightStdioSpec: mocks.preflightMock,
}));

vi.mock("../src/mcp/transport-from-spec.js", () => ({
  buildTransportFromSpec: () => new mocks.FakeTransport(),
}));

describe("acp --mcp loader", () => {
  afterEach(() => {
    mocks.initializeMock.mockReset();
    mocks.closeMock.mockReset();
    mocks.bridgeMock.mockReset();
    mocks.preflightMock.mockReset();
    mocks.readConfigMock.mockReset();
    mocks.readConfigMock.mockReturnValue({ mcpDisabled: [] });
    mocks.initializeMock.mockImplementation(async () => undefined);
    mocks.bridgeMock.mockImplementation(async (_c: unknown, opts: { namePrefix?: string }) => ({
      registeredNames: [`${opts.namePrefix ?? ""}echo`],
    }));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  async function callLoader(
    specs: string[],
    prefix?: string,
    sessionServers?: Record<string, import("../src/config.js").McpServerConfig>,
  ) {
    vi.resetModules();
    const { loadMcpServers } = await import("../src/cli/commands/acp.js");
    const { ToolRegistry } = await import("../src/tools.js");
    const tools = new ToolRegistry();
    const clients = await loadMcpServers(
      tools,
      specs,
      prefix,
      mkdtempSync(join(tmpdir(), "reasonix-acp-mcp-")),
      sessionServers,
    );
    return { clients, tools };
  }

  it("loads session/new HTTP servers alongside operator config", async () => {
    mocks.readConfigMock.mockReturnValue({
      mcpDisabled: [],
      mcpServers: { operator: { type: "http", url: "http://user.example/op" } },
    } as never);
    const { clients } = await callLoader([], undefined, {
      gate: { type: "http", url: "http://127.0.0.1:4000/session/s/mcp/gate", headers: {} },
    });
    expect(clients).toHaveLength(2);
    const names = mocks.bridgeMock.mock.calls.map(
      ([, opts]) => (opts as { serverName: string }).serverName,
    );
    expect(names.sort()).toEqual(["gate", "operator"]);
  });

  it("never lets a session server shadow an operator server", async () => {
    mocks.readConfigMock.mockReturnValue({
      mcpDisabled: [],
      mcpServers: { gate: { type: "http", url: "http://user.example/op" } },
    } as never);
    const { clients } = await callLoader([], undefined, {
      gate: { type: "http", url: "http://127.0.0.1:4000/session/s/mcp/gate", headers: {} },
    });
    expect(clients).toHaveLength(1);
  });

  it("bridges every spec with its name as the tool prefix", async () => {
    const { clients } = await callLoader(["fs=cmd1 a", "db=cmd2 b"]);
    expect(clients).toHaveLength(2);
    expect(mocks.initializeMock).toHaveBeenCalledTimes(2);
    expect(mocks.bridgeMock).toHaveBeenCalledTimes(2);
    const prefixes = mocks.bridgeMock.mock.calls.map(
      ([, opts]) => (opts as { namePrefix: string }).namePrefix,
    );
    expect(prefixes).toEqual(["fs_", "db_"]);
  });

  it("honors --mcp-prefix only for a single anonymous spec", async () => {
    const { clients } = await callLoader(["cmd1 a"], "pp_");
    expect(clients).toHaveLength(1);
    const opts = mocks.bridgeMock.mock.calls[0]?.[1] as { namePrefix: string };
    expect(opts.namePrefix).toBe("pp_");
  });

  it("ignores --mcp-prefix when multiple specs are passed", async () => {
    await callLoader(["a=cmd1", "cmd2"], "pp_");
    const calls = mocks.bridgeMock.mock.calls.map(
      ([, opts]) => (opts as { namePrefix: string }).namePrefix,
    );
    // Named spec uses its own prefix; anonymous one falls back to "" because multi-spec disables the global prefix.
    expect(calls).toEqual(["a_", ""]);
  });

  it("skips servers listed in config.mcpDisabled", async () => {
    mocks.readConfigMock.mockReturnValue({ mcpDisabled: ["fs"] });
    const { clients } = await callLoader(["fs=cmd1", "db=cmd2"]);
    expect(clients).toHaveLength(1);
    expect(mocks.initializeMock).toHaveBeenCalledTimes(1);
    const opts = mocks.bridgeMock.mock.calls[0]?.[1] as { serverName: string };
    expect(opts.serverName).toBe("db");
  });

  it("is non-fatal on initialize failure (logs + continues)", async () => {
    mocks.initializeMock
      .mockImplementationOnce(async () => {
        throw new Error("spawn ENOENT");
      })
      .mockImplementationOnce(async () => undefined);
    const { clients } = await callLoader(["bad=cmd1", "good=cmd2"]);
    expect(clients).toHaveLength(1);
    expect(mocks.closeMock).toHaveBeenCalledTimes(1); // bad client closed after failure
  });

  it("is non-fatal on malformed spec (parse error)", async () => {
    const { clients } = await callLoader(["fs=", "good=cmd2"]);
    expect(clients).toHaveLength(1);
    const opts = mocks.bridgeMock.mock.calls[0]?.[1] as { serverName: string };
    expect(opts.serverName).toBe("good");
  });

  it("returns [] when no specs are passed (no work done)", async () => {
    const { clients } = await callLoader([]);
    expect(clients).toEqual([]);
    expect(mocks.bridgeMock).not.toHaveBeenCalled();
    expect(mocks.initializeMock).not.toHaveBeenCalled();
  });
});

describe("session/new mcpServers conversion", () => {
  it("keeps http/sse servers with headers and drops stdio or malformed entries", async () => {
    const { sessionMcpServersToConfig } = await import("../src/cli/commands/acp.js");
    const out = sessionMcpServersToConfig([
      {
        type: "http",
        name: "gate",
        url: "http://127.0.0.1:4000/session/s/mcp/gate",
        headers: [{ name: "Authorization", value: "Bearer local" }],
      },
      { type: "sse", name: "events", url: "http://127.0.0.1:4000/sse" },
      { name: "local", command: "node", args: ["server.js"] },
      { type: "http", name: "", url: "http://x" },
      { type: "http", name: "nourl", url: "" },
    ] as never);
    expect(out).toEqual({
      gate: {
        type: "http",
        url: "http://127.0.0.1:4000/session/s/mcp/gate",
        headers: { Authorization: "Bearer local" },
      },
      events: { type: "sse", url: "http://127.0.0.1:4000/sse", headers: {} },
    });
    expect(sessionMcpServersToConfig(undefined)).toEqual({});
  });
});
