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
const WAITLIST_IR: ProductIR = {
  version: "1",
  product: { name: "Restaurant Waitlist", description: "Track waiting groups and seat the longest-waiting group next.", targetUser: "Restaurant host", genome: "workflow" },
  entities: [{ name: "group", plural: "groups", primaryField: "name", fields: [
    { id: "name", label: "Group name", type: "text", required: true },
    { id: "party_size", label: "Party size", type: "number", required: true, min: 1 },
    { id: "arrived_at", label: "Arrived at", type: "datetime", required: true },
    { id: "status", label: "Status", type: "status", required: true, options: ["Waiting", "Seated", "Left", "No response"] },
  ] }],
  capabilities: { create: true, edit: true, delete: true, search: true, filter: true, sort: true, group: true, transition: true, calculate: true },
  filters: [{ id: "waiting", label: "Waiting", field: "status", operator: "equals", value: "Waiting" }],
  calculations: [{ id: "total_groups", label: "Total groups", operation: "count" }, { id: "people_waiting", label: "People waiting", operation: "sumWhere", field: "status", operator: "equals", value: "Waiting", sumField: "party_size" }],
  charts: [], quickActions: [],
  priority: { label: "Next up", sortField: "arrived_at", direction: "asc", filter: { field: "status", operator: "equals", value: "Waiting" } },
  persistence: { strategy: "localStorage" }, assumptions: [], excluded: [], customRequirements: [],
};

describe("priority waitlist regression", () => {
  it("compiles the restaurant queue and verifies oldest-first reassignment", async () => {
    const appDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-waitlist-"));
    try {
      await cp(path.resolve("app-template"), appDirectory, { recursive: true, filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`) });
      await symlink(path.resolve("app-template", "node_modules"), path.join(appDirectory, "node_modules"), "dir");
      await copyFile(path.resolve("test", "fixtures", "waitlist-app.fixture.tsx"), path.join(appDirectory, "src", "Waitlist.test.tsx"));
      const ir = normalizeProductIR(validateProductIR(WAITLIST_IR));
      const route = classifyCapabilities(ir);
      expect(route.route).toBe("compile");
      expect(compileConfig(ir).priority).toMatchObject({ sortField: "arrived_at", direction: "asc" });
      await writeCompiledProduct(appDirectory, ir, route, deriveJourneys(ir));
      await execute("npm", ["test"], { cwd: appDirectory, timeout: 60_000 });
      await execute("npm", ["run", "build"], { cwd: appDirectory, timeout: 60_000 });
    } finally { await rm(appDirectory, { recursive: true }); }
  }, 120_000);
});
