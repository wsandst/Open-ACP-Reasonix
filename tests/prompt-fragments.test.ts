/** escalationContract — model-aware contract so the system prompt names the actual tier (#582). */

import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_FLASH, DEFAULT_MODEL_PRO } from "../src/defaults.js";
import { ESCALATION_CONTRACT, escalationContract } from "../src/prompt-fragments.js";

describe("escalationContract (#582)", () => {
  it("interpolates the actual model id for non-pro tiers", () => {
    const out = escalationContract(DEFAULT_MODEL_FLASH);
    expect(out).toContain(`\`${DEFAULT_MODEL_FLASH}\``);
    expect(out).toContain(`If asked which model you are, answer \`${DEFAULT_MODEL_FLASH}\``);
    expect(out).toContain("<<<NEEDS_PRO");
  });

  it("returns the no-escalation note for the pro tier instead of the full ladder", () => {
    const out = escalationContract(DEFAULT_MODEL_PRO);
    expect(out).toContain(`\`${DEFAULT_MODEL_PRO}\``);
    expect(out).toContain("escalation tier");
    expect(out).toContain(`If asked which model you are, answer \`${DEFAULT_MODEL_PRO}\``);
    expect(out).not.toContain("<<<NEEDS_PRO: <one-sentence reason>>>>");
  });

  it("never tells a pro session it is running on flash (regression for #582)", () => {
    const out = escalationContract(DEFAULT_MODEL_PRO);
    expect(out).not.toMatch(new RegExp(`running on \`?${DEFAULT_MODEL_FLASH}\`?`));
  });

  it("backward-compat const matches the historical flash phrasing", () => {
    expect(ESCALATION_CONTRACT).toBe(escalationContract(DEFAULT_MODEL_FLASH));
  });

  it("treats unknown future tiers as non-pro (full contract, name themselves)", () => {
    const out = escalationContract("some-other-vendor/exp-1");
    expect(out).toContain("`some-other-vendor/exp-1`");
    expect(out).toContain("<<<NEEDS_PRO");
  });
});
