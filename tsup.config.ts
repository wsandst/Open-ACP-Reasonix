import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: ["@reasonix/core-utils"],
  },
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist/cli",
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }",
    },
    platform: "node",
    // Externalize declared npm dependencies (resolved from node_modules at
    // runtime) and bundle only the local, unpublished workspace package — same
    // policy as the library build above. Force-bundling the entire dependency
    // tree (the previous `noExternal: [/.*/]`) produced a broken single-file
    // ESM bundle: packages that ship .wasm and load it via their own
    // `__dirname` (tiktoken → tiktoken_bg.wasm, web-tree-sitter, tree-sitter-*)
    // cannot resolve their assets once inlined, and `__dirname` is undefined in
    // ESM scope. tokenizer.ts already assumes tiktoken lives in node_modules
    // (it `req.resolve("tiktoken/package.json")`s), so externalizing is the
    // correct, conventional packaging — deps are installed by `npm i -g` /
    // `npm ci` alongside dist/.
    noExternal: ["@reasonix/core-utils"],
  },
]);
