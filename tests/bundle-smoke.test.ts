/** Post-build smoke — built bundles boot and resolve externalized native deps. */

// The CLI bundle externalizes declared npm deps (resolved from node_modules at
// runtime) and inlines only the local @reasonix/core-utils workspace package.
// Force-bundling the whole tree broke at runtime: tiktoken's CJS shim uses
// __dirname (undefined in ESM) and loads tiktoken_bg.wasm relative to it.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const LIB_BUNDLE = resolve("dist/index.js");
const CLI_BUNDLE = resolve("dist/cli/index.js");
const CLI_DIR = resolve("dist/cli");

const libExists = existsSync(LIB_BUNDLE);
const cliExists = existsSync(CLI_BUNDLE);

describe("bundled dist — boot + native dep resolution", () => {
  (libExists ? it : it.skip)(
    "dist/index.js exercises tiktoken (truncateForModelByTokens) without ENOENT / __dirname crash",
    () => {
      const libUrl = pathToFileURL(LIB_BUNDLE).href;
      const result = spawnSync(
        "node",
        [
          "--input-type=module",
          "-e",
          `import { truncateForModelByTokens } from "${libUrl}";
           const s = "hello world ".repeat(500);
           const out = truncateForModelByTokens(s, 100);
           console.log(JSON.stringify({ ok: true, len: out.length }));`,
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
      expect(result.stderr).not.toMatch(/ENOENT/);
      expect(result.stderr).not.toMatch(/__dirname is not defined/);
      expect(result.stderr).not.toMatch(/Cannot find (module|package)/);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/"ok":true/);
    },
  );

  (cliExists ? it : it.skip)(
    "dist/cli inlines the local @reasonix/core-utils workspace package (never imported from node_modules)",
    () => {
      const jsFiles = readdirSync(CLI_DIR).filter((f) => f.endsWith(".js"));
      const leaked = jsFiles.filter((f) =>
        /from\s*["']@reasonix\/core-utils["']/.test(readFileSync(resolve(CLI_DIR, f), "utf8")),
      );
      expect(
        leaked,
        `dist/cli must bundle @reasonix/core-utils, but these files import it: ${leaked.join(", ")}`,
      ).toEqual([]);
    },
  );

  (cliExists ? it : it.skip)(
    "dist/cli/index.js boots (--help) without a module-resolution / __dirname crash",
    () => {
      const result = spawnSync("node", [CLI_BUNDLE, "--help"], {
        encoding: "utf8",
        timeout: 15_000,
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(combined).not.toMatch(/__dirname is not defined/);
      expect(combined).not.toMatch(/ENOENT/);
      expect(combined).not.toMatch(/Cannot find (module|package)/);
      expect(result.status).toBe(0);
    },
  );

  (cliExists ? it : it.skip)(
    "dist/cli/index.js doctor resolves the tokenizer (tiktoken) from the bundle layout",
    () => {
      // doctor probes tokenizer/config/endpoint status. The crucial assertion
      // is that loading the bundle + tiktoken does not crash on asset/module
      // resolution from the dist/cli layout.
      const result = spawnSync("node", [CLI_BUNDLE, "doctor"], {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, OPENROUTER_API_KEY: "sk-smoke-bogus" },
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(combined).not.toMatch(/__dirname is not defined/);
      expect(combined).not.toMatch(/ENOENT/);
    },
  );
});
