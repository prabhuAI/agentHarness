import { describe, expect, it } from "vitest";
import { classifyCapabilities } from "../solution/compiler/capability-map.js";
import { compileConfig } from "../solution/compiler/compile.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import type { ProductIR } from "../solution/ir/types.js";

// A single-entity spend tracker with a category facet, a currency measure, a
// date, a numeric count, and a boolean — enough to exercise every new predicate,
// aggregate, chart, and quick-action shape.
function spendIR(overrides: Partial<ProductIR> = {}): ProductIR {
  return {
    version: "1",
    product: { name: "Spend", description: "Track spending.", targetUser: "One person", genome: "ledger", accent: "#4f46e5" },
    entities: [{
      name: "expense", plural: "expenses", primaryField: "title",
      fields: [
        { id: "title", label: "Title", type: "text", required: true },
        { id: "category", label: "Category", type: "category", required: false, options: ["Food", "Rent", "Fun"], allowCustom: false },
        { id: "amount", label: "Amount", type: "currency", required: false },
        { id: "spent_on", label: "Spent on", type: "date", required: false },
        { id: "count", label: "Count", type: "number", required: false },
        { id: "reimbursed", label: "Reimbursed", type: "boolean", required: false },
        { id: "status", label: "Status", type: "status", required: false, options: ["Open", "Closed"], allowCustom: false },
      ],
    }],
    capabilities: {},
    filters: [], calculations: [], charts: [], quickActions: [],
    persistence: { strategy: "localStorage" },
    assumptions: [], excluded: [], customRequirements: [],
    ...overrides,
  };
}

describe("P2 filter operators", () => {
  it("keeps comparison, contains, and range predicates over valid fields", () => {
    const ir = normalizeProductIR(spendIR({
      filters: [
        { id: "big", label: "Over 100", field: "amount", operator: "greaterThan", value: "100" },
        { id: "named", label: "Has coffee", field: "title", operator: "contains", value: "coffee" },
        { id: "window", label: "This range", field: "spent_on", operator: "between", value: "2026-01-01", valueEnd: "2026-01-31" },
      ],
    }));
    const kept = new Map(ir.filters.map((filter) => [filter.id, filter]));
    expect(kept.get("big")?.operator).toBe("greaterThan");
    expect(kept.get("named")?.operator).toBe("contains");
    expect(kept.get("window")?.valueEnd).toBe("2026-01-31");
  });

  it("drops a between filter missing its upper bound and before/after on a non-date field", () => {
    const ir = normalizeProductIR(spendIR({
      filters: [
        { id: "halfrange", label: "Bad range", field: "amount", operator: "between", value: "10" },
        { id: "badbefore", label: "Bad before", field: "amount", operator: "before", value: "5" },
      ],
    }));
    expect(ir.filters.some((filter) => filter.id === "halfrange" || filter.id === "badbefore")).toBe(false);
  });
});

describe("P3 aggregates and charts", () => {
  it("keeps average/min/max over numeric fields and conditional aggregates", () => {
    const ir = normalizeProductIR(spendIR({
      calculations: [
        { id: "avg", label: "Average", operation: "average", field: "amount" },
        { id: "peak", label: "Peak", operation: "max", field: "amount" },
        { id: "food_avg", label: "Food avg", operation: "avgWhere", field: "category", operator: "equals", value: "Food", sumField: "amount" },
      ],
    }));
    const ops = new Set(ir.calculations.map((calculation) => calculation.operation));
    expect(ops.has("average")).toBe(true);
    expect(ops.has("max")).toBe(true);
    expect(ops.has("avgWhere")).toBe(true);
  });

  it("keeps a bar chart on a category axis and a line chart on date+number, dropping a bar chart without options", () => {
    const ir = normalizeProductIR(spendIR({
      charts: [
        { id: "by_cat", label: "By category", type: "bar", xField: "category", yField: "amount" },
        { id: "trend", label: "Trend", type: "line", xField: "spent_on", yField: "amount" },
        { id: "bad_bar", label: "Bad", type: "bar", xField: "title" },
      ],
    }));
    const byId = new Map(ir.charts.map((chart) => [chart.id, chart]));
    expect(byId.get("by_cat")?.type).toBe("bar");
    expect(byId.get("trend")?.type).toBe("line");
    expect(byId.has("bad_bar")).toBe(false);
  });
});

describe("P4 quick-action verbs", () => {
  it("keeps increment/toggle/setValue/now against type-matched fields and drops mismatches", () => {
    const ir = normalizeProductIR(spendIR({
      quickActions: [
        { id: "plus", label: "+1", field: "count", set: "increment", amount: 2 },
        { id: "flip", label: "Toggle", field: "reimbursed", set: "toggle" },
        { id: "close", label: "Close", field: "status", set: "setValue", value: "Closed" },
        { id: "bad_inc", label: "Bad", field: "title", set: "increment" },
        { id: "bad_set", label: "Bad set", field: "status", set: "setValue", value: "Nope" },
      ],
    }));
    const byId = new Map(ir.quickActions.map((action) => [action.id, action]));
    expect(byId.get("plus")?.amount).toBe(2);
    expect(byId.get("flip")?.set).toBe("toggle");
    expect(byId.get("close")?.value).toBe("Closed");
    expect(byId.has("bad_inc")).toBe(false);
    expect(byId.has("bad_set")).toBe(false);
  });
});

describe("P6 export capability", () => {
  it("defaults export off so it never appears unrequested", () => {
    const ir = normalizeProductIR(spendIR());
    expect(ir.capabilities.export).toBe(false);
    expect(compileConfig(ir).capabilities.export).toBe(false);
  });

  it("enables export when the idea asks for it and stays on the compile route", () => {
    const ir = normalizeProductIR(spendIR({ capabilities: { export: true } }));
    expect(ir.capabilities.export).toBe(true);
    expect(compileConfig(ir).capabilities.export).toBe(true);
    expect(classifyCapabilities(ir).route).toBe("compile");
  });
});

// A loan → book relation for the reference primitive.
function relationIR(refEntity: string): ProductIR {
  return {
    version: "1",
    product: { name: "Library", description: "Loans of books.", targetUser: "A librarian", genome: "tracker", accent: "#4f46e5" },
    entities: [
      { name: "book", plural: "books", primaryField: "title", fields: [{ id: "title", label: "Title", type: "text", required: true }] },
      { name: "loan", plural: "loans", primaryField: "borrower", fields: [
        { id: "borrower", label: "Borrower", type: "text", required: true },
        { id: "book", label: "Book", type: "reference", required: false, refEntity },
      ] },
    ],
    capabilities: {},
    filters: [], calculations: [], charts: [], quickActions: [],
    persistence: { strategy: "localStorage" },
    assumptions: [], excluded: [], customRequirements: [],
  };
}

describe("P1 entity relations", () => {
  it("resolves a reference field to its canonical target entity", () => {
    const ir = normalizeProductIR(relationIR("book"));
    const bookField = ir.entities[1]!.fields.find((field) => field.id === "book");
    expect(bookField?.type).toBe("reference");
    expect(bookField?.refEntity).toBe("book");
  });

  it("degrades a dangling reference to plain text", () => {
    const ir = normalizeProductIR(relationIR("nonexistent"));
    const bookField = ir.entities[1]!.fields.find((field) => field.id === "book");
    expect(bookField?.type).toBe("text");
    expect(bookField?.refEntity).toBeUndefined();
  });
});
