import { execFile } from "node:child_process";
import { copyFile, cp, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { classifyCapabilities } from "../solution/compiler/capability-map.js";
import { compileConfig, writeCompiledProduct } from "../solution/compiler/compile.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { validateProductIR } from "../solution/ir/schema.js";
import type { ProductIR } from "../solution/ir/types.js";
import { deriveJourneys } from "../solution/qa/derive-journeys.js";

const execute = promisify(execFile);

const LEAGUE_IR: ProductIR = {
  version: "1",
  product: { name: "League Manager", description: "Enter teams and results and see a live league table.", targetUser: "Local football league organizer", genome: "tracker" },
  entities: [
    { name: "team", plural: "teams", primaryField: "name", fields: [{ id: "name", label: "Team name", type: "text", required: true }] },
    { name: "match", plural: "matches", primaryField: "home_team", fields: [
      { id: "home_team", label: "Home team", type: "category", required: true },
      { id: "away_team", label: "Away team", type: "category", required: true },
      { id: "home_goals", label: "Home goals", type: "number", required: true, min: 0 },
      { id: "away_goals", label: "Away goals", type: "number", required: true, min: 0 },
    ] },
  ],
  capabilities: { create: true, edit: true, delete: true, search: true, filter: false, sort: true, group: false, transition: false, calculate: true },
  filters: [], calculations: [{ id: "total_teams", label: "Total teams", operation: "count" }], charts: [], quickActions: [],
  standings: [{
    id: "league_table", label: "League table", rowEntity: "team", sourceEntity: "match",
    participants: [
      { entityField: "home_team", scoreForField: "home_goals", scoreAgainstField: "away_goals" },
      { entityField: "away_team", scoreForField: "away_goals", scoreAgainstField: "home_goals" },
    ],
    points: { win: 3, draw: 1, loss: 0 },
  }],
  persistence: { strategy: "localStorage" }, assumptions: ["Standard 3/1/0 scoring"], excluded: [], customRequirements: [],
};

describe("multi-entity standings regression", () => {
  it("compiles the league idea to the deterministic route and verifies its real UI journey", async () => {
    const appDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-league-"));
    try {
      await cp(path.resolve("app-template"), appDirectory, { recursive: true, filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`) });
      await symlink(path.resolve("app-template", "node_modules"), path.join(appDirectory, "node_modules"), "dir");
      await copyFile(path.resolve("test", "fixtures", "league-app.fixture.tsx"), path.join(appDirectory, "src", "League.test.tsx"));
      const ir = normalizeProductIR(validateProductIR(LEAGUE_IR));
      const route = classifyCapabilities(ir);
      const config = compileConfig(ir);
      expect(route.route).toBe("compile");
      expect(route.unsupported).toEqual([]);
      expect(config.entities).toHaveLength(2);
      expect(config.standings?.[0]).toMatchObject({ rowEntity: "team", sourceEntity: "match", points: { win: 3, draw: 1, loss: 0 } });
      expect(deriveJourneys(ir).map((journey) => journey.id)).toEqual(expect.arrayContaining(["related_entities", "standings"]));
      await writeCompiledProduct(appDirectory, ir, route, deriveJourneys(ir));
      await execute("npm", ["test"], { cwd: appDirectory, timeout: 60_000 });
      await execute("npm", ["run", "build"], { cwd: appDirectory, timeout: 60_000 });
    } finally { await rm(appDirectory, { recursive: true }); }
  }, 120_000);
});
