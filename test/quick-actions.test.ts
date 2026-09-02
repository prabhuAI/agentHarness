import { describe, expect, it } from "vitest";
import { classifyCapabilities } from "../solution/compiler/capability-map.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { validateProductIR } from "../solution/ir/schema.js";
import type { ProductIR } from "../solution/ir/types.js";

// The quickActions capability is the deterministic form of the recurring
// "Done!"/"Mark paid"/"Returned" button — promoted out of the hybrid (LLM) route
// so an idea that needs it compiles in one model call. These guard the normalize
// rules (which actions survive) and that a quick action keeps the compile route.
const base = (quickActions: unknown[]): ProductIR => ({
  version: "1",
  product: { name: "Last Done", description: "", targetUser: "", genome: "tracker" },
  entities: [{
    name: "activity", plural: "activities", primaryField: "name",
    fields: [
      { id: "name", label: "Activity", type: "text", required: true },
      { id: "last_done", label: "Last done", type: "date", required: false },
      { id: "count", label: "Count", type: "number", required: false },
      { id: "streak", label: "Streak", type: "number", required: false, derive: { kind: "formula", expression: "count + 1" } },
    ],
  }],
  capabilities: { create: true, edit: true, delete: true, search: true, filter: false, sort: true, group: false, transition: false, calculate: false },
  filters: [], calculations: [], charts: [],
  quickActions: quickActions as ProductIR["quickActions"],
  persistence: { strategy: "localStorage" }, assumptions: [], excluded: [], customRequirements: [],
});

describe("quickActions capability", () => {
  it("keeps a valid 'today' action on a date field", () => {
    const ir = normalizeProductIR(validateProductIR(base([{ id: "did", label: "Done!", field: "last_done", set: "today" }])));
    expect(ir.quickActions).toHaveLength(1);
    expect(ir.quickActions[0]!).toMatchObject({ field: "last_done", set: "today" });
  });

  it("keeps a valid 'clear' action on any enterable field", () => {
    const ir = normalizeProductIR(validateProductIR(base([{ id: "reset", label: "Reset", field: "count", set: "clear" }])));
    expect(ir.quickActions).toHaveLength(1);
    expect(ir.quickActions[0]!.set).toBe("clear");
  });

  it("drops a 'today' action targeting a non-date field", () => {
    const ir = normalizeProductIR(validateProductIR(base([{ id: "bad", label: "Nope", field: "count", set: "today" }])));
    expect(ir.quickActions).toHaveLength(0);
  });

  it("drops an action targeting a missing or derived field", () => {
    const missing = normalizeProductIR(validateProductIR(base([{ id: "a", label: "A", field: "ghost", set: "today" }])));
    const derived = normalizeProductIR(validateProductIR(base([{ id: "b", label: "B", field: "streak", set: "clear" }])));
    expect(missing.quickActions).toHaveLength(0);
    expect(derived.quickActions).toHaveLength(0);
  });

  it("routes an idea with a quick action through the deterministic compile route", () => {
    const ir = normalizeProductIR(validateProductIR(base([{ id: "did", label: "Done!", field: "last_done", set: "today" }])));
    const route = classifyCapabilities(ir);
    expect(route.route).toBe("compile");
    expect(route.unsupported).toHaveLength(0);
  });
});

// A status-advance button ("move the order to the next stage") is a setValue
// quick action. The full compile path is validateProductIR -> normalizeProductIR;
// these guard the validator gate specifically, because it once hard-rejected
// every set except today/clear even though the schema, prompt, runtime, and
// normalizer already supported the wider vocabulary. Every other quickActions
// test uses today/clear, so nothing here previously exercised the gate for the
// increment/toggle/setValue verbs.
const pipeline = (quickActions: unknown[]): ProductIR => ({
  version: "1",
  product: { name: "Workshop Orders", description: "", targetUser: "", genome: "workflow" },
  entities: [{
    name: "order", plural: "orders", primaryField: "customer",
    fields: [
      { id: "customer", label: "Customer", type: "text", required: true },
      { id: "status", label: "Status", type: "status", required: true, options: ["Request", "Quoted", "Building", "Completed"] },
      { id: "revisions", label: "Revisions", type: "number", required: false },
      { id: "rush", label: "Rush", type: "boolean", required: false },
    ],
  }],
  capabilities: { create: true, edit: true, delete: true, search: true, filter: true, sort: true, group: false, transition: true, calculate: false },
  filters: [], calculations: [], charts: [],
  quickActions: quickActions as ProductIR["quickActions"],
  persistence: { strategy: "localStorage" }, assumptions: [], excluded: [], customRequirements: [],
});

describe("quickActions vocabulary passes the validator gate", () => {
  it("validates a setValue action that advances a status to a declared option", () => {
    const raw = pipeline([{ id: "build", label: "Start building", field: "status", set: "setValue", value: "Building" }]);
    expect(() => validateProductIR(raw)).not.toThrow();
    const ir = normalizeProductIR(validateProductIR(raw));
    expect(ir.quickActions).toHaveLength(1);
    expect(ir.quickActions[0]!).toMatchObject({ field: "status", set: "setValue", value: "Building" });
  });

  it("validates increment and toggle actions against type-matched fields", () => {
    const raw = pipeline([
      { id: "bump", label: "+1 revision", field: "revisions", set: "increment", amount: 1 },
      { id: "flip", label: "Toggle rush", field: "rush", set: "toggle" },
    ]);
    expect(() => validateProductIR(raw)).not.toThrow();
    const ir = normalizeProductIR(validateProductIR(raw));
    expect(ir.quickActions.map((action) => action.set)).toEqual(["increment", "toggle"]);
  });

  it("rejects a genuinely unknown set verb", () => {
    expect(() => validateProductIR(pipeline([{ id: "x", label: "X", field: "status", set: "teleport" }]))).toThrow();
  });

  it("keeps a status-advance idea on the deterministic compile route", () => {
    const ir = normalizeProductIR(validateProductIR(pipeline([{ id: "build", label: "Start building", field: "status", set: "setValue", value: "Building" }])));
    expect(classifyCapabilities(ir).route).toBe("compile");
  });
});
