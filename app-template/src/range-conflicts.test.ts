import { describe, expect, it } from "vitest";
import type { RangeConflictConfig } from "./product-config.js";
import { evaluateRangeConflict } from "./range-conflicts.js";
import type { EntityRecord } from "./repository.js";

const rule: RangeConflictConfig = {
  id: "no_overlap",
  matchField: "resource",
  startField: "starts",
  endField: "ends",
  ignoreWhen: { field: "state", values: ["Cancelled"] },
  detailFields: ["customer"],
};

const record = (id: string, resource: string, starts: string, ends: string, state = "Reserved"): EntityRecord => ({
  id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  values: { resource, starts, ends, state, customer: "Existing customer" },
});

describe("inclusive range conflict validation", () => {
  const existing = [record("one", "Canon R5", "2026-09-10", "2026-09-12")];

  it("blocks a case-insensitive match whose range overlaps or touches an endpoint", () => {
    const overlap = evaluateRangeConflict(rule, { resource: " canon  r5 ", starts: "2026-09-12", ends: "2026-09-14" }, existing);
    expect(overlap.conflicts.map((item) => item.id)).toEqual(["one"]);
  });

  it("allows adjacent non-overlapping dates, another resource, and the record being edited", () => {
    expect(evaluateRangeConflict(rule, { resource: "Canon R5", starts: "2026-09-13", ends: "2026-09-14" }, existing).conflicts).toEqual([]);
    expect(evaluateRangeConflict(rule, { resource: "Sony A7", starts: "2026-09-10", ends: "2026-09-12" }, existing).conflicts).toEqual([]);
    expect(evaluateRangeConflict(rule, { resource: "Canon R5", starts: "2026-09-10", ends: "2026-09-12" }, existing, "one").conflicts).toEqual([]);
  });

  it("ignores cancelled candidates and existing records", () => {
    const candidate = { resource: "Canon R5", starts: "2026-09-10", ends: "2026-09-12", state: "cancelled" };
    expect(evaluateRangeConflict(rule, candidate, existing).conflicts).toEqual([]);
    expect(evaluateRangeConflict(rule, { ...candidate, state: "Reserved" }, [record("one", "Canon R5", "2026-09-10", "2026-09-12", "Cancelled")]).conflicts).toEqual([]);
  });

  it("reports reversed and incomplete ranges without inventing conflicts", () => {
    expect(evaluateRangeConflict(rule, { resource: "Canon R5", starts: "2026-09-14", ends: "2026-09-13" }, existing)).toMatchObject({ ready: true, invalidOrder: true, conflicts: [] });
    expect(evaluateRangeConflict(rule, { resource: "Canon R5", starts: "", ends: "2026-09-13" }, existing)).toMatchObject({ ready: false, invalidOrder: false, conflicts: [] });
  });
});
