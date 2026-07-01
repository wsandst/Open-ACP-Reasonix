import { describe, expect, it } from "vitest";
import { disabledToolNamesFromEnv } from "../src/cli/commands/acp.js";

describe("disabledToolNamesFromEnv", () => {
  it("returns [] when unset or empty", () => {
    expect(disabledToolNamesFromEnv({})).toEqual([]);
    expect(disabledToolNamesFromEnv({ REASONIX_DISABLE_TOOLS: "" })).toEqual([]);
    expect(disabledToolNamesFromEnv({ REASONIX_DISABLE_TOOLS: "  " })).toEqual([]);
  });

  it("splits on commas and whitespace, trimming blanks", () => {
    expect(
      disabledToolNamesFromEnv({
        REASONIX_DISABLE_TOOLS: "remember, recall_memory ,forget  ask_choice",
      }),
    ).toEqual(["remember", "recall_memory", "forget", "ask_choice"]);
  });
});
