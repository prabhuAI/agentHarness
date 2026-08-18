import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyRequiredArtifacts } from "../src/validate-artifacts.js";
import { TraceWriter } from "../solution/telemetry/trace.js";

describe("required artifact verification", () => {
  it("accepts a complete auditable artifact set and rejects missing output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-artifacts-"));
    try {
      expect((await verifyRequiredArtifacts(directory)).result).toBe("failed");
      await Promise.all([
        writeFile(path.join(directory, "idea_spec.json"), JSON.stringify({ target_user: "User", core_utility: "Utility", included_features: [], excluded_features: [], assumptions: [] })),
        writeFile(path.join(directory, "product-ir.json"), JSON.stringify({ version: "1", product: {}, entities: [] })),
        writeFile(path.join(directory, "summary.md"), "# Product\n"),
      ]);
      const trace = new TraceWriter(directory);
      await trace.reset();
      for (const action of ["interpret", "scope", "route", "compile", "verify"]) {
        await trace.record({ agent: "product", action, status: "success" });
      }
      expect((await verifyRequiredArtifacts(directory)).result).toBe("passed");
    } finally { await rm(directory, { recursive: true }); }
  });
});
