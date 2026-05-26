import { describe, expect, it } from "vitest";
import { t } from "../src/index/semantic/i18n.js";

describe("semantic i18n", () => {
  it("substitutes {placeholders} from vars", () => {
    const out = t("modelPullFailed", { model: "nomic-embed-text", code: 137 });
    expect(out).toContain("nomic-embed-text");
    expect(out).toContain("137");
  });

  it("leaves {var} literal when the key is missing from vars", () => {
    const out = t("modelPullFailed", { model: "x" }); // no `code`
    expect(out).toContain("x");
    expect(out).toContain("{code}");
  });

  it("returns the EN string for a key without vars", () => {
    expect(t("ollamaNotFound")).toMatch(/ollama/i);
  });
});
