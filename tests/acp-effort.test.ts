import { describe, expect, it } from "vitest";
import { resolveEffort } from "../src/cli/commands/acp.js";

describe("resolveEffort", () => {
  it("honors a valid --effort override", () => {
    expect(resolveEffort("low")).toBe("low");
    expect(resolveEffort("max")).toBe("max");
  });

  it("falls back to config default when unset or invalid", () => {
    // No config file in the test env → loadReasoningEffort() default "high".
    expect(resolveEffort(undefined)).toBe("high");
    expect(resolveEffort("turbo")).toBe("high");
    expect(resolveEffort("")).toBe("high");
  });
});
