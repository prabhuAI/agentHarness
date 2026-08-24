import { describe, expect, it } from "vitest";
import { type ProductConfig, productConfig, type StandingsConfig } from "./product-config.js";
import { resolveViewPlan } from "./view-plan.js";

const configured = (overrides: Partial<ProductConfig>): ProductConfig => ({ ...productConfig, ...overrides });

describe("deterministic view planning", () => {
  it("selects structurally different views from existing product semantics", () => {
    const status = { key: "stage", label: "Stage", type: "status" as const, options: ["New", "Done"] };
    expect(resolveViewPlan(configured({ fields: [status], capabilities: { ...productConfig.capabilities, group: true }, standings: [] })).primary).toBe("board");
    expect(resolveViewPlan(configured({ genome: "planner", fields: [{ key: "date", label: "Date", type: "date" }], standings: [] })).primary).toBe("agenda");
    const plainFields = [{ key: "name", label: "Name", type: "text" as const }];
    expect(resolveViewPlan(configured({ genome: "catalog", fields: plainFields, standings: [] })).primary).toBe("gallery");
    expect(resolveViewPlan(configured({ genome: "dashboard", fields: plainFields, standings: [] })).primary).toBe("dashboard");
    expect(resolveViewPlan(configured({ genome: "tracker", fields: Array.from({ length: 7 }, (_, index) => ({ key: `field_${index}`, label: `Field ${index}`, type: "text" as const })), summaries: [], charts: [], standings: [] })).primary).toBe("table");
    expect(resolveViewPlan(configured({ genome: "tracker", fields: [{ key: "name", label: "Name", type: "text" }], summaries: [], charts: [], entities: [], standings: [] })).primary).toBe("cards");
  });

  it("makes standings and multi-entity navigation the highest-priority plan", () => {
    const standings: StandingsConfig[] = [{
      id: "ranking", label: "Ranking", rowEntity: "team", sourceEntity: "match",
      participants: [
        { entityField: "home", scoreForField: "home_score", scoreAgainstField: "away_score" },
        { entityField: "away", scoreForField: "away_score", scoreAgainstField: "home_score" },
      ],
      points: { win: 3, draw: 1, loss: 0 },
    }];
    const entities = [
      { name: "team", plural: "teams", primaryField: "name", secondaryFields: [], searchableFields: ["name"], fields: [{ key: "name", label: "Name", type: "text" as const }] },
      { name: "match", plural: "matches", primaryField: "home", secondaryFields: [], searchableFields: [], fields: [{ key: "home", label: "Home", type: "category" as const }] },
    ];
    expect(resolveViewPlan(configured({ standings, entities }))).toEqual(expect.objectContaining({ primary: "standings", navigation: "sections" }));
  });
});
