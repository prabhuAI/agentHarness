import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_IDEAS } from "../benchmarks/suite.js";
import { classifyCapabilities } from "../solution/compiler/capability-map.js";
import { compileConfig, writeCompiledProduct } from "../solution/compiler/compile.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { ProductIRValidationError, validateProductIR } from "../solution/ir/schema.js";
import type { ProductIR } from "../solution/ir/types.js";
import { TokenGovernor, weightedTokens } from "../solution/orchestrator/budget.js";
import { deriveJourneys } from "../solution/qa/derive-journeys.js";
import { classifyFailure } from "../solution/qa/classify.js";
import { deterministicRepair } from "../solution/repair/deterministic.js";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))); });

function fixture(overrides: Partial<ProductIR> = {}): ProductIR {
  return {
    version: "1",
    product: { name: "Decision Log", description: "Keep lightweight decisions retrievable.", tagline: "Decide, record, revisit.", targetUser: "Small project teams", genome: "workflow", accent: "#4f46e5" },
    entities: [{
      name: "decision", plural: "decisions", primaryField: "title",
      fields: [
        { id: "title", label: "Title", type: "text", required: true },
        { id: "owner", label: "Owner", type: "text", required: true },
        { id: "status", label: "Status", type: "status", required: true, options: ["Proposed", "Accepted"], allowCustom: false },
        { id: "rationale", label: "Rationale", type: "longText", required: false },
      ],
    }],
    capabilities: { create: true, edit: true, delete: true, search: true, filter: true, sort: false, group: false, transition: true, calculate: true },
    filters: [{ id: "accepted", label: "Accepted", field: "status", operator: "equals", value: "Accepted" }],
    calculations: [{ id: "total", label: "Total decisions", operation: "count" }, { id: "accepted", label: "Accepted", operation: "countWhere", field: "status", operator: "equals", value: "Accepted" }],
    persistence: { strategy: "localStorage" },
    assumptions: ["Single workspace"], excluded: ["Authentication"], customRequirements: [],
    ...overrides,
  };
}

describe("Product IR compiler", () => {
  it("validates, normalizes, routes, and compiles supported ideas deterministically", () => {
    const ir = normalizeProductIR(validateProductIR(fixture()));
    const route = classifyCapabilities(ir);
    const config = compileConfig(ir);
    expect(route.route).toBe("compile");
    expect(config).toMatchObject({ name: "Decision Log", genome: "workflow", primaryField: "title" });
    expect(config.filters).toHaveLength(1);
    expect(config.summaries).toHaveLength(2);
    expect(deriveJourneys(ir).map((journey) => journey.id)).toEqual(expect.arrayContaining(["create", "persistence", "filter", "calculate", "delete"]));
  });

  it("normalizes duplicate identifiers and rejects malformed IR", () => {
    const duplicate = fixture();
    duplicate.entities[0]!.fields[1]!.id = "title";
    const normalized = normalizeProductIR(validateProductIR(duplicate));
    expect(new Set(normalized.entities[0].fields.map((field) => field.id)).size).toBe(normalized.entities[0].fields.length);
    expect(() => validateProductIR({ version: "1" })).toThrow(ProductIRValidationError);
  });

  it("routes only unsupported core interactions to bounded custom work", () => {
    const hybrid = fixture({ customRequirements: ["Render an interactive dependency graph"] });
    expect(classifyCapabilities(normalizeProductIR(validateProductIR(hybrid))).route).toBe("hybrid");
    const custom = fixture({ customRequirements: ["Realtime canvas", "Audio synthesis", "Physics simulation"] });
    expect(classifyCapabilities(normalizeProductIR(validateProductIR(custom))).route).toBe("custom");
  });

  it("compiles grouping when the product has a category or status field", () => {
    const grouped = fixture({
      capabilities: { ...fixture().capabilities, group: true },
    });
    const ir = normalizeProductIR(validateProductIR(grouped));
    expect(classifyCapabilities(ir).route).toBe("compile");
    expect(compileConfig(ir).capabilities.group).toBe(true);
    expect(deriveJourneys(ir)).toContainEqual(expect.objectContaining({ id: "group" }));
  });

  it("generates required artifacts directly from Product IR", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-compiler-"));
    temporaryDirectories.push(directory);
    const ir = normalizeProductIR(validateProductIR(fixture()));
    const route = classifyCapabilities(ir);
    await writeCompiledProduct(directory, ir, route, deriveJourneys(ir));
    const spec = JSON.parse(await readFile(path.join(directory, "idea_spec.json"), "utf8")) as Record<string, unknown>;
    const config = JSON.parse(await readFile(path.join(directory, "product.config.json"), "utf8")) as Record<string, unknown>;
    expect(spec.target_user).toBe("Small project teams");
    expect(config.name).toBe("Decision Log");
    expect(await readFile(path.join(directory, "summary.md"), "utf8")).toContain("npm run dev");
  });

  it("ships at least 100 diverse raw benchmark ideas and computes the official weight", () => {
    expect(BENCHMARK_IDEAS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(BENCHMARK_IDEAS).size).toBe(BENCHMARK_IDEAS.length);
    expect(weightedTokens(100, 20, 50)).toBe(165);
    expect(new TokenGovernor().snapshot("compile").state).toBe("green");
  });

  it("classifies failures and applies only known deterministic repairs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-repair-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, "product.config.json"), JSON.stringify({
      primaryField: "missing", secondaryFields: ["missing"], searchableFields: ["missing"],
      fields: [{ key: "name", label: "Name", type: "text" }],
    }));
    const failure = classifyFailure("build", "product.config primaryField is undefined");
    expect(failure.category).toBe("configuration");
    expect((await deterministicRepair(directory, failure)).applied).toBe(true);
    const repaired = JSON.parse(await readFile(path.join(directory, "product.config.json"), "utf8")) as Record<string, unknown>;
    expect(repaired.primaryField).toBe("name");
  });
});
