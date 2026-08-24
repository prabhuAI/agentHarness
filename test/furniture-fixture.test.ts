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

const FURNITURE_ORDERS_IR: ProductIR = {
  version: "1",
  product: {
    name: "Furniture Orders",
    description: "Track custom furniture orders through collection and monitor unpaid balances.",
    targetUser: "Custom furniture maker",
    genome: "workflow",
  },
  entities: [{
    name: "order",
    plural: "orders",
    primaryField: "piece",
    fields: [
      { id: "piece", label: "Piece", type: "text", required: true },
      { id: "status", label: "Status", type: "status", required: true, options: ["Quote", "Accepted", "Building", "Ready", "Collected"] },
      { id: "price", label: "Price", type: "currency", required: true },
      { id: "deposit", label: "Deposit paid", type: "currency", required: false },
      { id: "balance_due", label: "Balance due", type: "currency", required: false, derive: { kind: "formula", expression: "price - deposit" } },
      { id: "paid", label: "Paid in full", type: "boolean", required: false },
    ],
  }],
  capabilities: { create: true, edit: true, delete: true, search: true, filter: true, sort: true, group: true, transition: true, calculate: true },
  filters: [
    { id: "unpaid", label: "Unpaid", field: "paid", operator: "falsy" },
    { id: "building", label: "Building", field: "status", operator: "equals", value: "Building" },
  ],
  calculations: [
    { id: "unpaid_balance", label: "Outstanding balance", operation: "sumWhere", field: "paid", operator: "falsy", sumField: "balance_due" },
  ],
  charts: [],
  quickActions: [],
  persistence: { strategy: "localStorage" },
  assumptions: [],
  excluded: [],
  customRequirements: [],
};

describe("furniture order regression", () => {
  it("compiles Building state and unpaid balance through the tested runtime", async () => {
    const appDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-furniture-"));
    try {
      await cp(path.resolve("app-template"), appDirectory, {
        recursive: true,
        filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`),
      });
      await symlink(path.resolve("app-template", "node_modules"), path.join(appDirectory, "node_modules"), "dir");
      await copyFile(path.resolve("test", "fixtures", "furniture-app.fixture.tsx"), path.join(appDirectory, "src", "Furniture.test.tsx"));
      const ir = normalizeProductIR(validateProductIR(FURNITURE_ORDERS_IR));
      const route = classifyCapabilities(ir);
      const config = compileConfig(ir);

      expect(route.route).toBe("compile");
      expect(config.filters).toContainEqual(expect.objectContaining({ field: "status", operator: "equals", value: "Building" }));
      expect(config.filters[0]).toMatchObject({ field: "paid", operator: "falsy" });
      expect(config.summaries).toContainEqual(expect.objectContaining({
        id: "unpaid_balance",
        operation: "sumWhere",
        field: "paid",
        operator: "falsy",
        sumField: "balance_due",
      }));
      expect(config.fields).toContainEqual(expect.objectContaining({
        key: "balance_due",
        derive: { kind: "formula", expression: "price - deposit" },
      }));

      await writeCompiledProduct(appDirectory, ir, route, deriveJourneys(ir));
      await execute("npm", ["test"], { cwd: appDirectory, timeout: 60_000 });
      await execute("npm", ["run", "build"], { cwd: appDirectory, timeout: 60_000 });
    } finally { await rm(appDirectory, { recursive: true }); }
  }, 120_000);
});
