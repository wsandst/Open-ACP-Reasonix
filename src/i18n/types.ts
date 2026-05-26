/** Schema type derived from EN. The t() shim looks up strings dynamically; this
 *  type exists for callers that want compile-time hints on `t("group.key")`. */

import type { EN } from "./EN.js";

export type TranslationSchema = typeof EN;
