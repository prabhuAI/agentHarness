import { describe, expect, it } from "vitest";
import { type PresentationConfig, productConfig } from "./product-config.js";
import { resolveViewPlan } from "./view-plan.js";

describe("compiled view planning", () => {
  it("uses the compiler's presentation as the single runtime authority", () => {
    const presentation: PresentationConfig = {
      primary: "agenda", navigation: "sections", variant: "weekly",
      reason: "date-centered planning by starts_at", dateField: "starts_at",
    };
    expect(resolveViewPlan({ ...productConfig, presentation })).toEqual(presentation);
  });

  it("retains the deterministic variant and structural grouping field", () => {
    const presentation: PresentationConfig = {
      primary: "board", navigation: "single", variant: "pipeline",
      reason: "workflow grouped by stage", groupField: "stage",
    };
    expect(resolveViewPlan({ ...productConfig, presentation })).toMatchObject({ primary: "board", variant: "pipeline", groupField: "stage" });
  });
});
