import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PUBLIC_BOOK_LENDING_IR } from "../benchmarks/public-fixture.js";
import { classifyCapabilities } from "../solution/compiler/capability-map.js";
import { compileConfig, writeCompiledProduct } from "../solution/compiler/compile.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { validateProductIR } from "../solution/ir/schema.js";
import { deriveJourneys } from "../solution/qa/derive-journeys.js";

const execute = promisify(execFile);

describe("public development fixture", () => {
  it("compiles the published ambiguity into a tested, buildable, domain-neutral runtime config", async () => {
    const appDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-public-fixture-"));
    try {
      await cp(path.resolve("app-template"), appDirectory, {
        recursive: true,
        filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`),
      });
      await symlink(path.resolve("app-template", "node_modules"), path.join(appDirectory, "node_modules"), "dir");
      const ir = normalizeProductIR(validateProductIR(PUBLIC_BOOK_LENDING_IR));
      const route = classifyCapabilities(ir);
      const config = compileConfig(ir);
      expect(route.route).toBe("compile");
      expect(config.filters).toContainEqual(expect.objectContaining({ field: "borrower", operator: "nonEmpty" }));
      expect(config.summaries).toContainEqual(expect.objectContaining({ operation: "countWhere", field: "borrower" }));
      expect(config.fields.find((field) => field.key === "category")).toMatchObject({ allowCustom: true });
      await writeCompiledProduct(appDirectory, ir, route, deriveJourneys(ir));
      await execute("npm", ["test"], { cwd: appDirectory, timeout: 60_000 });
      await execute("npm", ["run", "build"], { cwd: appDirectory, timeout: 60_000 });
    } finally { await rm(appDirectory, { recursive: true }); }
  }, 120_000);
});
