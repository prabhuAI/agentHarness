import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyRequiredArtifacts } from "../src/validate-artifacts.js";
import { sha256File, TraceWriter } from "../solution/telemetry/trace.js";

describe("required artifact verification", () => {
  it("accepts a complete auditable artifact set and rejects missing output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-artifacts-"));
    try {
      expect((await verifyRequiredArtifacts(directory)).result).toBe("failed");
      await Promise.all([
        writeFile(path.join(directory, "idea_spec.json"), JSON.stringify({ target_user: "User", core_utility: "Utility", included_features: [], excluded_features: [], assumptions: [] })),
        writeFile(path.join(directory, "product-ir.json"), JSON.stringify({ version: "1", product: {}, entities: [] })),
        writeFile(path.join(directory, "summary.md"), "# Product\n\n## Verified journeys\n"),
        writeFile(path.join(directory, "report.partial.json"), JSON.stringify({ status: "success" })),
      ]);
      const trace = new TraceWriter(directory);
      await trace.reset();
      await trace.record({ agent: "product", action: "interpret_idea", status: "success" });
      await trace.record({ agent: "product", action: "select_scope", status: "success", included: ["create"], assumptions: ["Single user"], excluded: ["Authentication"], customRequirements: [] });
      await trace.record({ agent: "router", action: "select_strategy", status: "success", reason: "All behavior is deterministic.", supported: ["create"], unsupported: [] });
      await trace.record({ agent: "compiler", action: "generate_application", status: "success" });
      await trace.record({ agent: "qa", action: "verify_journeys", status: "success" });
      const names = ["idea_spec.json", "product-ir.json", "summary.md", "report.partial.json"];
      const artifacts = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await sha256File(path.join(directory, name))])));
      await trace.record({ agent: "delivery", action: "finalize", status: "success", artifacts });
      expect((await verifyRequiredArtifacts(directory)).result).toBe("passed");
    } finally { await rm(directory, { recursive: true }); }
  });

  it("rejects a trace that omits auditable scope and route decisions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-artifacts-thin-trace-"));
    try {
      await Promise.all([
        writeFile(path.join(directory, "idea_spec.json"), JSON.stringify({ target_user: "User", core_utility: "Utility", included_features: [], excluded_features: [], assumptions: [] })),
        writeFile(path.join(directory, "product-ir.json"), JSON.stringify({ version: "1", product: {}, entities: [] })),
        writeFile(path.join(directory, "summary.md"), "# Product\n\n## Verified journeys\n"),
        writeFile(path.join(directory, "report.partial.json"), JSON.stringify({ status: "success" })),
      ]);
      const trace = new TraceWriter(directory);
      await trace.reset();
      await trace.record({ agent: "product", action: "interpret_idea", status: "success" });
      await trace.record({ agent: "product", action: "select_scope", status: "success", included: 1, excluded: 0 });
      await trace.record({ agent: "router", action: "select_strategy", status: "success", strategy: "compile" });
      await trace.record({ agent: "compiler", action: "generate_application", status: "success" });
      await trace.record({ agent: "qa", action: "verify_journeys", status: "success" });
      const names = ["idea_spec.json", "product-ir.json", "summary.md", "report.partial.json"];
      const artifacts = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await sha256File(path.join(directory, name))])));
      await trace.record({ agent: "delivery", action: "finalize", status: "success", artifacts });
      expect((await verifyRequiredArtifacts(directory)).result).toBe("failed");
    } finally { await rm(directory, { recursive: true }); }
  });
});
