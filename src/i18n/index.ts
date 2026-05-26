/** English-only translation lookup; thin shim so existing call sites keep compiling. */

import { EN } from "./EN.js";
import type { TranslationSchema } from "./types.js";

const translations: TranslationSchema = EN;

/** Returns a structured (non-string) translation entry — for callers that
 *  fetch a row object rather than a leaf string. */
export function tObj<T>(path: string): T {
  return resolve(path) as T;
}

/** Nested-key lookup with `{name}` parameter substitution. */
export function t(path: string, params?: Record<string, string | number>): string {
  const val = resolve(path);
  if (typeof val !== "string") return path;
  if (!params) return val;
  let result = val;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return result;
}

function resolve(path: string): unknown {
  const parts = path.split(".");
  let val: unknown = translations;
  for (const part of parts) {
    val = (val as Record<string, unknown> | undefined)?.[part];
    if (val === undefined) return undefined;
  }
  return val;
}

/** Legacy no-op shims — kept so callers that haven't been edited still compile. */
export function setLanguage(_lang: string): void {}
export function setLanguageRuntime(_lang: string): void {}
export function getLanguage(): string {
  return "EN";
}
export function onLanguageChange(_cb: () => void): () => void {
  return () => {};
}
export function notifyLanguageChange(): void {}
