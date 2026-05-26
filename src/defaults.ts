/** Single source of truth for hardcoded default model IDs. Swapping providers
 *  means editing this file (plus pricing + tokenizer wiring). */

/** Cheap default — the "flash" tier. Used as DEFAULT_MODEL, subagent default,
 *  context-fold summary model, force-summary model, and code-prompt model. */
export const DEFAULT_MODEL_FLASH = "openai/gpt-4o-mini";

/** Escalation tier — the "pro" model that subagents / users can opt into when
 *  the flash tier underperforms (skill frontmatter `model: <pro>`, /pro slash). */
export const DEFAULT_MODEL_PRO = "openai/gpt-5";

/** Back-compat alias for code that historically read a single DEFAULT_MODEL. */
export const DEFAULT_MODEL = DEFAULT_MODEL_FLASH;

/** UI / TUI model picker hint list — first entry is the cheap default. */
export const DEFAULT_MODEL_LIST = [DEFAULT_MODEL_FLASH, DEFAULT_MODEL_PRO] as const;

/** Slash-preset → model id. Used by /flash, /pro and the subagent `preset` field. */
export function modelForPreset(preset: "flash" | "pro"): string {
  return preset === "pro" ? DEFAULT_MODEL_PRO : DEFAULT_MODEL_FLASH;
}

/** True when the model emits reasoning that must round-trip on follow-up calls.
 *  Provider-agnostic heuristic: OpenAI o-series, DeepSeek reasoner / v4, anything
 *  with "reasoner" / "thinking" / "o1" / "o3" in the id. */
export function isThinkingCapableModel(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes("reasoner")) return true;
  if (m.includes("deepseek-v4")) return true;
  if (m.includes("/o1") || m.includes("/o3") || m.includes("/o4")) return true;
  if (m.endsWith("-thinking") || m.includes(":thinking")) return true;
  return false;
}
