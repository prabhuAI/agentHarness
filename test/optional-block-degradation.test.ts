import { describe, expect, it } from "vitest";
import { coerceStringifiedIR } from "../solution/extensions/product-compiler.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { validateProductIR } from "../solution/ir/schema.js";
import type { ProductIR } from "../solution/ir/types.js";

// Guard against the recurring "strict validator hard-fails a degradable optional
// block -> wasteful repair model call" bug. Every optional enhancement block that
// normalizeProductIR is designed to drop when malformed (priority, derive,
// visibleWhen, plus the optional `version` tool argument) must pass validation and
// normalize cleanly rather than throwing a ProductIRValidationError. If a new
// optional block reintroduces a missing-field hard-fail, this test fails in CI
// instead of surfacing live as a two-model-call run.

function baseIR(): ProductIR {
  return {
    version: "1",
    product: { name: "Widget Tracker", description: "Track widgets.", targetUser: "Solo maker", genome: "tracker" },
    entities: [{
      name: "widget", plural: "widgets", primaryField: "title",
      fields: [
        { id: "title", label: "Title", type: "text", required: true },
        { id: "owner", label: "Owner", type: "text", required: false },
      ],
    }],
    capabilities: { create: true, edit: true, delete: true, search: true, filter: true, sort: false, group: false, transition: false, calculate: false },
    filters: [], calculations: [], charts: [],
    persistence: { strategy: "localStorage" },
    assumptions: [], excluded: [], quickActions: [], customRequirements: [],
  } as ProductIR;
}

// Each case injects a structurally incomplete optional block onto an otherwise
// valid IR. The raw object is what a model might emit; the block is missing a
// part that the strict validator once demanded.
const incompleteOptionalBlocks: Array<{ name: string; mutate: (ir: Record<string, unknown>) => void }> = [
  { name: "priority missing sortField", mutate: (ir) => { ir.priority = { label: "Next up", direction: "asc" }; } },
  { name: "derive formula missing expression", mutate: (ir) => { (ir.entities as any)[0].fields[1].derive = { kind: "formula" }; } },
  { name: "derive presence missing sourceField", mutate: (ir) => { (ir.entities as any)[0].fields[1].derive = { kind: "presence", whenPresent: "A", whenEmpty: "B" }; } },
  { name: "derive unknown kind", mutate: (ir) => { (ir.entities as any)[0].fields[1].derive = { kind: "nonsense" }; } },
  { name: "derive dateThreshold missing buckets", mutate: (ir) => { (ir.entities as any)[0].fields[1].derive = { kind: "dateThreshold", dateField: "title" }; } },
  { name: "visibleWhen missing field and equals", mutate: (ir) => { (ir.entities as any)[0].fields[1].visibleWhen = {}; } },
  { name: "visibleWhen missing equals", mutate: (ir) => { (ir.entities as any)[0].fields[1].visibleWhen = { field: "owner" }; } },
];

describe("optional IR blocks degrade instead of forcing a repair call", () => {
  for (const { name, mutate } of incompleteOptionalBlocks) {
    it(`accepts and normalizes an IR with ${name}`, () => {
      const raw = baseIR() as unknown as Record<string, unknown>;
      mutate(raw);
      // Must not throw: an incomplete optional block is not a correctness error.
      const validated = validateProductIR(raw);
      const normalized = normalizeProductIR(validated);
      // The malformed block is dropped, so the product still compiles.
      expect(normalized.entities[0]!.fields.length).toBeGreaterThan(0);
      expect(normalized.priority).toBeUndefined();
    });
  }

  it("defaults a missing tool-argument version to \"1\" instead of rejecting", () => {
    const raw = baseIR() as unknown as Record<string, unknown>;
    delete raw.version;
    const coerced = coerceStringifiedIR(raw) as Record<string, unknown>;
    expect(coerced.version).toBe("1");
    expect(() => validateProductIR(coerced)).not.toThrow();
  });

  it("still rejects genuinely unbuildable IR (no entity, no product name)", () => {
    const noEntity = baseIR() as unknown as Record<string, unknown>;
    noEntity.entities = [];
    expect(() => validateProductIR(noEntity)).toThrow();
    const noName = baseIR() as unknown as Record<string, unknown>;
    (noName.product as Record<string, unknown>).name = "";
    expect(() => validateProductIR(noName)).toThrow();
  });
});
