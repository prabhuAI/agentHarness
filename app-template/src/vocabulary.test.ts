import { describe, expect, it } from "vitest";
import { chartBreakdown, computeSummaryValue, matchesPredicate } from "./App.js";
import { parseImportedRecords, recordsToCsv, recordsToJson } from "./io.js";
import { productConfig, type ChartConfig, type SummaryConfig } from "./product-config.js";
import type { EntityRecord } from "./repository.js";

const rec = (values: Record<string, string | number | boolean>): EntityRecord =>
  ({ id: values.title as string ?? "id", createdAt: "2026-01-01", updatedAt: "2026-01-01", values });

describe("P2 matchesPredicate operators", () => {
  it("compares numbers, text, and ranges", () => {
    expect(matchesPredicate(120, "greaterThan", "100")).toBe(true);
    expect(matchesPredicate(80, "atLeast", "100")).toBe(false);
    expect(matchesPredicate("Iced coffee", "contains", "coffee")).toBe(true);
    expect(matchesPredicate("Tea", "notEquals", "Coffee")).toBe(true);
    expect(matchesPredicate(15, "between", "10", new Date(), "20")).toBe(true);
    expect(matchesPredicate(25, "between", "10", new Date(), "20")).toBe(false);
  });

  it("treats before/after as chronological on ISO dates", () => {
    expect(matchesPredicate("2026-01-05", "before", "2026-01-10")).toBe(true);
    expect(matchesPredicate("2026-01-15", "after", "2026-01-10")).toBe(true);
  });
});

describe("P3 aggregates and breakdowns", () => {
  const records = [rec({ title: "a", category: "Product", amount: 10 }), rec({ title: "b", category: "Product", amount: 30 }), rec({ title: "c", category: "Service", amount: 20 })];
  it("computes average, min, and max", () => {
    expect(computeSummaryValue({ id: "x", label: "Avg", operation: "average", field: "amount" } as SummaryConfig, records)).toBe(20);
    expect(computeSummaryValue({ id: "x", label: "Min", operation: "min", field: "amount" } as SummaryConfig, records)).toBe(10);
    expect(computeSummaryValue({ id: "x", label: "Max", operation: "max", field: "amount" } as SummaryConfig, records)).toBe(30);
  });
  it("groups a bar/pie breakdown by category, summing a measure when given", () => {
    const summed = chartBreakdown({ id: "c", label: "By cat", type: "bar", xField: "category", yField: "amount" } as ChartConfig, records);
    expect(summed.find((slice) => slice.label === "Product")?.value).toBe(40);
    const counted = chartBreakdown({ id: "c", label: "By cat", type: "pie", xField: "category" } as ChartConfig, records);
    expect(counted.find((slice) => slice.label === "Product")?.value).toBe(2);
  });
});

describe("P6 export/import round-trip", () => {
  // Config-agnostic: exercise export/import against whatever primary field the
  // active product.config.json defines, so this passes for any compiled app (the
  // fixture regression suites copy this test into their own workspaces).
  const enterable = productConfig.fields.filter((field) => !field.derive);
  const key = enterable[0]!.key;
  const records = [rec({ [key]: "First" }), rec({ [key]: "Second" })];
  it("exports JSON that re-imports to the same primary-field values", () => {
    const parsed = parseImportedRecords(recordsToJson(records));
    expect(parsed).toHaveLength(2);
    expect(parsed[0][key]).toBe("First");
    expect(parsed[1][key]).toBe("Second");
  });
  it("exports CSV with a header row and one row per record", () => {
    const lines = recordsToCsv(records).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(enterable[0]!.label);
  });
  it("drops unknown keys and rejects non-array input", () => {
    const parsed = parseImportedRecords(JSON.stringify([{ [key]: "Ok", bogus_field_zzz: "x" }]));
    expect(parsed[0]).toEqual({ [key]: "Ok" });
    expect(() => parseImportedRecords(JSON.stringify({ not: "array" }))).toThrow();
  });
});
