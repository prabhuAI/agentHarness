import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { coerceStringifiedIR, productIRSchema } from "../solution/extensions/product-compiler.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { validateProductIR } from "../solution/ir/schema.js";

// Regression guards for weak-model tool-call quirks observed with Qwen3.8:
// (1) a nested container emitted as a JSON string instead of real JSON,
// (2) that JSON string itself malformed (a stray trailing brace), and
// (3) a date field chosen as the record's primary (renders formatted, so its
//     raw value never matches the create/persistence journey's text lookup).
// All three are repaired deterministically so any model reaches a valid IR.
describe("tool-argument robustness", () => {
  const entitiesArray = [{
    name: "weighin",
    plural: "weighins",
    primaryField: "date",
    fields: [
      { id: "date", label: "Date", type: "date", required: true },
      { id: "weight", label: "Weight (kg)", type: "number", required: true },
      { id: "note", label: "Note", type: "text" },
    ],
  }];
  const baseArgs = {
    version: "1",
    product: { name: "Weight Tracker", genome: "tracker" },
    capabilities: { create: true, edit: true, delete: true, search: true },
  };

  it("advertises a schema that accepts a stringified container (no validation loop)", () => {
    const stringified = { ...baseArgs, entities: JSON.stringify(entitiesArray) };
    // The strict shape would reject a string here; the tolerant tool schema accepts it.
    expect(Value.Check(productIRSchema, stringified)).toBe(true);
    // A genuinely broken IR (no entities at all) is still rejected.
    expect(Value.Check(productIRSchema, { ...baseArgs })).toBe(false);
  });

  it("coerces a stringified entities array back into JSON", () => {
    const coerced = coerceStringifiedIR({ ...baseArgs, entities: JSON.stringify(entitiesArray) }) as Record<string, unknown>;
    expect(Array.isArray(coerced.entities)).toBe(true);
    expect((coerced.entities as unknown[]).length).toBe(1);
  });

  it("repairs a stringified entities array that has trailing junk (a stray closing brace)", () => {
    const malformed = `${JSON.stringify(entitiesArray)}}`; // extra } appended, as Qwen produced
    const coerced = coerceStringifiedIR({ ...baseArgs, entities: malformed }) as Record<string, unknown>;
    const entities = coerced.entities as Array<{ name: string }>;
    expect(Array.isArray(entities)).toBe(true);
    expect(entities[0]?.name).toBe("weighin");
  });

  it("leaves a genuine text value that is not JSON untouched", () => {
    const coerced = coerceStringifiedIR({ ...baseArgs, entities: entitiesArray, product: { name: "Weight Tracker [beta]" } }) as Record<string, unknown>;
    expect((coerced.product as { name: string }).name).toBe("Weight Tracker [beta]");
  });

  it("does not choose a date field as the primary when a non-date field exists", () => {
    const coerced = coerceStringifiedIR({ ...baseArgs, entities: JSON.stringify(entitiesArray) });
    const ir = normalizeProductIR(validateProductIR(coerced));
    expect(ir.entities[0].primaryField).not.toBe("date");
    expect(ir.entities[0].primaryField).toBe("weight");
  });

  it("still allows a date primary when the entity has only date and derived fields", () => {
    const dateOnly = [{ name: "log", plural: "logs", primaryField: "day", fields: [{ id: "day", label: "Day", type: "date", required: true }] }];
    const ir = normalizeProductIR(validateProductIR({ ...baseArgs, entities: dateOnly }));
    expect(ir.entities[0].primaryField).toBe("day");
  });
});
