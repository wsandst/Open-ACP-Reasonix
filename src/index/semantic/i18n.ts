/** Semantic-search user-facing strings. English-only after the fork
 *  (upstream shipped EN + ZH; the ZH table + locale plumbing were dropped). */

const EN = {
  // ── preflight ─────────────────────────────────────────────────────
  ollamaNotFound:
    "✗ `ollama` not found on PATH.\n  Install from https://ollama.com (one-time, ~150 MB), then retry.\n",
  daemonNotReachableHint:
    "✗ Ollama daemon not reachable. Run `ollama serve` and retry, or pass --yes to start it automatically.\n",
  daemonStartConfirm: "Ollama daemon isn't running. Start `ollama serve` now?",
  daemonAbortStart: "✗ aborted — start `ollama serve` yourself and retry.\n",
  daemonStarting: "▸ starting `ollama serve`…\n",
  daemonStartTimeout:
    "✗ daemon didn't come up within 15s. Try `ollama serve` in a separate terminal and retry.\n",
  daemonReady: "✓ daemon up{pid}\n",
  modelNotPulledHint:
    '✗ embedding model "{model}" not pulled. Run `ollama pull {model}` and retry, or pass --yes to pull it automatically.\n',
  modelPullConfirm:
    'Embedding model "{model}" isn\'t pulled yet. Pull it now? (~274 MB for nomic-embed-text)',
  modelAbortPull: "✗ aborted — pull the model yourself and retry.\n",
  modelPulling: "▸ pulling {model}…\n",
  modelPullFailed: "✗ `ollama pull {model}` failed (exit {code}).\n",
  modelPulled: "✓ {model} pulled\n",

  // ── progress ─────────────────────────────────────────────────────
  progressStarting: "starting…",
  progressScan: "scanning project · {files} files",
  progressEmbed: "embedding {done}/{total} chunks · {pct}%",
  progressEmbedHeartbeat: "  {done}/{total}\n",
  progressScanLine: "scanning files…\n",
  progressEmbedLine: "embedding {total} chunks across {files} files…\n",
  indexSuccess:
    "✓ indexed {scanned} files ({changed} changed, {added} new chunks, {removed} stale removed) in {seconds}s\n",
  indexSuccessWithSkips:
    "✓ indexed {scanned} files ({changed} changed, {added} new chunks, {removed} stale removed, {skipped} skipped due to embed errors) in {seconds}s\n",
  indexNothingToDo: "  (nothing to do — re-run with --rebuild to force a full rebuild)\n",
  indexFailed: "✗ index failed: {msg}\n",

  // ── /semantic slash ──────────────────────────────────────────────
  slashHeader: "semantic_search status",
  slashEnabled: "✓ enabled — index built, tool registered.",
  slashEnabledDetail: "  index size: {chunks} chunks across {files} files",
  slashEnabledHowto: "  the model will call semantic_search automatically when it fits.",
  slashIndexMissing: "✗ no index built yet for this project.",
  slashHowToBuild: "  to enable, exit Reasonix and run in your shell:\n      reasonix index",
  slashOllamaMissing: "  prerequisite: install Ollama from https://ollama.com",
  slashDaemonDown:
    "  Ollama is installed but the daemon isn't running. start it with: ollama serve",
  slashIndexInfo:
    "  what semantic_search does: cross-language code understanding via local embeddings.\n  better than grep when you describe WHAT something does, not WHICH token to find.",
} as const;

export function t(key: keyof typeof EN, vars: Record<string, string | number> = {}): string {
  return EN[key].replace(/\{(\w+)\}/g, (_m, name) => {
    const v = vars[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}
