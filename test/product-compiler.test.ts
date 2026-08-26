import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_IDEAS } from "../benchmarks/suite.js";
import { classifyCapabilities } from "../solution/compiler/capability-map.js";
import { compileConfig, writeCompiledProduct } from "../solution/compiler/compile.js";
import { resolveDesign } from "../solution/design/catalog.js";
import { resolvePresentation } from "../solution/design/presentation.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { ProductIRValidationError, validateProductIR } from "../solution/ir/schema.js";
import type { ProductIR } from "../solution/ir/types.js";
import { TokenGovernor, weightedTokens } from "../solution/orchestrator/budget.js";
import { deriveJourneys } from "../solution/qa/derive-journeys.js";
import { classifyFailure } from "../solution/qa/classify.js";
import { deterministicRepair } from "../solution/repair/deterministic.js";
import { coerceStringifiedIR } from "../solution/extensions/product-compiler.js";

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
    charts: [],
    persistence: { strategy: "localStorage" },
    assumptions: ["Single workspace"], excluded: ["Authentication"], quickActions: [], customRequirements: [],
    ...overrides,
  };
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/gu)!.map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Product IR compiler", () => {
  it("promotes explicit empty/non-empty field coupling out of the hybrid route", () => {
    const coupling = "When a book is marked Returned (borrower field cleared), also set its status to On shelf; when a borrower name is entered for a book on the shelf, set its status to Lent out. These two fields should stay coupled.";
    const ir = normalizeProductIR(validateProductIR(fixture({
      product: { name: "Home Library", description: "Track books and borrowers.", targetUser: "A reader", genome: "catalog" },
      entities: [{
        name: "book", plural: "books", primaryField: "title",
        fields: [
          { id: "title", label: "Title", type: "text", required: true },
          { id: "borrower", label: "Borrowed by", type: "text", required: false },
          { id: "status", label: "Status", type: "status", required: false, options: ["On shelf", "Lent out"] },
        ],
      }],
      quickActions: [{ id: "returned", label: "Returned", field: "borrower", set: "clear" }],
      customRequirements: [coupling],
    })));

    expect(ir.entities[0].fields.find((field) => field.id === "status")?.derive).toEqual({
      kind: "presence", sourceField: "borrower", empty: "On shelf", nonEmpty: "Lent out",
    });
    expect(ir.customRequirements).toEqual([]);
    expect(classifyCapabilities(ir).route).toBe("compile");
  });

  it("does not discard novel work while promoting a proven presence coupling", () => {
    const ir = normalizeProductIR(validateProductIR(fixture({
      entities: [{
        name: "decision", plural: "decisions", primaryField: "title",
        fields: [
          { id: "title", label: "Title", type: "text", required: true },
          { id: "owner", label: "Owner", type: "text", required: false },
          { id: "status", label: "Status", type: "status", required: false, options: ["Unassigned", "Assigned"] },
        ],
      }],
      quickActions: [{ id: "unassign", label: "Unassign", field: "owner", set: "clear" }],
      customRequirements: [
        "When owner is cleared set status to Unassigned; when owner is entered set status to Assigned.",
        "Render an interactive dependency graph.",
      ],
    })));

    expect(ir.customRequirements).toEqual(["Render an interactive dependency graph."]);
    expect(classifyCapabilities(ir).route).toBe("hybrid");
  });

  it("repairs one impossible closing brace inside a stringified container", () => {
    const entities = JSON.stringify(fixture().entities);
    const fieldsEnd = entities.lastIndexOf("]}");
    const malformed = `${entities.slice(0, fieldsEnd)}}${entities.slice(fieldsEnd)}`;

    const coerced = coerceStringifiedIR({ ...fixture(), entities: malformed }) as ProductIR;

    expect(coerced.entities).toEqual(fixture().entities);
  });

  it("does not guess when malformed stringified JSON needs more than removing one impossible closer", () => {
    const malformed = '[{"name":"decision","fields":[{"id":"title"}}}}]}]';
    const coerced = coerceStringifiedIR({ ...fixture(), entities: malformed }) as { entities: unknown };

    expect(coerced.entities).toBe(malformed);
  });

  it("validates, normalizes, routes, and compiles supported ideas deterministically", () => {
    const ir = normalizeProductIR(validateProductIR(fixture()));
    const route = classifyCapabilities(ir);
    const config = compileConfig(ir);
    expect(route.route).toBe("compile");
    expect(config).toMatchObject({
      name: "Decision Log",
      genome: "workflow",
      presentation: { primary: "tracker" },
      primaryField: "title",
      design: { layout: "progress-workbench", tone: "professional", density: "compact" },
    });
    expect(config.presentation.groupField).toBeUndefined();
    expect(config.capabilities.group).toBe(false);
    expect(config.filters).toHaveLength(2);
    expect(config.summaries).toHaveLength(3);
    expect(deriveJourneys(ir).map((journey) => journey.id)).toEqual(expect.arrayContaining(["create", "persistence", "filter", "calculate", "delete"]));
  });

  it("derives one filter and one count per category/status option instead of requiring the model to enumerate them", () => {
    const ir = normalizeProductIR(validateProductIR(fixture()));
    // status has options ["Proposed", "Accepted"]; the model only wrote an "Accepted" filter and count.
    expect(ir.filters).toContainEqual(expect.objectContaining({ field: "status", operator: "equals", value: "Proposed" }));
    expect(ir.filters).toContainEqual(expect.objectContaining({ field: "status", operator: "equals", value: "Accepted" }));
    expect(ir.calculations).toContainEqual(expect.objectContaining({ field: "status", operation: "countWhere", value: "Proposed" }));
    expect(ir.filters).toHaveLength(2);
    expect(ir.calculations).toHaveLength(3);

    // A status/category facet with options is inherently filterable and
    // summarizable, so an under-scoped model that turned filter/calculate off does
    // not strand the option set: normalization forces them on and derives anyway.
    const underScoped = fixture({ capabilities: { ...fixture().capabilities, filter: false, calculate: false } });
    const normalized = normalizeProductIR(validateProductIR(underScoped));
    expect(normalized.capabilities.filter).toBe(true);
    expect(normalized.capabilities.calculate).toBe(true);
    expect(normalized.filters).toHaveLength(2);
    expect(normalized.calculations).toHaveLength(3);
  });

  it("keeps the explicit metric when an auto-derived status metric repeats its label", () => {
    const collision = fixture();
    collision.entities[0]!.fields.push({ id: "borrower", label: "Borrowed by", type: "text", required: false });
    collision.entities[0]!.fields.find((field) => field.id === "status")!.options = ["On shelf", "Lent out"];
    collision.calculations = [
      { id: "total", label: "Total books", operation: "count" },
      { id: "lent", label: "Lent out", operation: "countWhere", field: "borrower", operator: "nonEmpty" },
    ];
    const normalized = normalizeProductIR(validateProductIR(collision));
    expect(normalized.calculations.filter((calculation) => calculation.label === "Lent out")).toEqual([
      expect.objectContaining({ id: "lent", field: "borrower", operator: "nonEmpty" }),
    ]);
    expect(normalized.calculations).toContainEqual(expect.objectContaining({ label: "On shelf", field: "status" }));
  });

  it("deduplicates an entity-scoped explicit metric against the primary entity's derived facet metric", () => {
    const hiring = fixture();
    hiring.entities[0]!.name = "candidate";
    hiring.entities[0]!.plural = "candidates";
    hiring.entities[0]!.fields.find((field) => field.id === "status")!.options = ["New", "Hired"];
    hiring.calculations = [
      { id: "total_candidates", label: "Total candidates", entity: "candidate", operation: "count" },
      { id: "hired", label: "Hired", entity: "candidate", operation: "countWhere", field: "status", operator: "equals", value: "Hired" },
    ];
    const normalized = normalizeProductIR(validateProductIR(hiring));
    expect(normalized.calculations.filter((calculation) => calculation.label === "Hired")).toEqual([
      expect.objectContaining({ id: "hired", entity: "candidate", value: "Hired" }),
    ]);
  });

  it("coerces option-bearing fields to a choice type so weaker models render a select", () => {
    // Weaker models (e.g. a small local model) often tag an enumerated field as
    // "text" while still supplying options; the runtime only renders a select for
    // category/status, so normalization must reclassify it.
    const mislabeled = fixture();
    mislabeled.entities[0]!.fields.push({ id: "category", label: "Category", type: "text", required: true, options: ["Groceries", "Pharmacy", "Other"], allowCustom: true });
    const normalized = normalizeProductIR(validateProductIR(mislabeled));
    const category = normalized.entities[0].fields.find((field) => field.id === "category");
    expect(category?.type).toBe("category");
    expect(category?.options).toEqual(["Groceries", "Pharmacy", "Other"]);
    // The status lifecycle is the primary facet, so its options become the filter
    // chips; the coerced category stays reachable via grouping/search rather than
    // adding one chip per genre. This keeps the derived filter set short.
    expect(normalized.filters).toContainEqual(expect.objectContaining({ field: "status", operator: "equals", value: "Proposed" }));
    expect(normalized.filters.some((filter) => filter.field === "category")).toBe(false);
    // A field with no options keeps whatever type the model chose.
    expect(normalized.entities[0].fields.find((field) => field.id === "owner")?.type).toBe("text");
  });

  it("keeps a valid formula derived field numeric and drops an unusable one", () => {
    // A per-record arithmetic value over sibling numeric fields compiles as a
    // computed number — the deterministic path that replaces a custom patch.
    const withFormula = fixture();
    withFormula.entities[0]!.fields.push(
      { id: "target", label: "Target", type: "currency", required: true },
      { id: "current", label: "Current", type: "currency", required: false },
      { id: "remaining", label: "Remaining", type: "currency", required: false, derive: { kind: "formula", expression: "target - current" } as never },
      // References a text field → not numeric → dropped, degrading to a plain field.
      { id: "bogus", label: "Bogus", type: "number", required: false, derive: { kind: "formula", expression: "title + 1" } as never },
    );
    const normalized = normalizeProductIR(validateProductIR(withFormula));
    const remaining = normalized.entities[0].fields.find((field) => field.id === "remaining");
    expect(remaining?.type).toBe("currency");
    expect(remaining?.derive).toEqual({ kind: "formula", expression: "target - current" });
    expect(remaining?.required).toBe(false); // computed fields are never user-required
    const bogus = normalized.entities[0].fields.find((field) => field.id === "bogus");
    expect(bogus?.derive).toBeUndefined(); // unusable formula dropped
    // A formula field is not a facet, so it never adds filter chips.
    expect(normalized.filters.some((filter) => filter.field === "remaining")).toBe(false);
    // The idea still compiles on the cheap route — no custom requirement introduced.
    expect(classifyCapabilities(normalized).route).toBe("compile");
  });

  it("derives filters for one meaningful facet: status when present, else a category", () => {
    // Status wins over category so the item's core state drives the chips.
    const withStatus = normalizeProductIR(validateProductIR(fixture()));
    expect(withStatus.filters.map((filter) => filter.value).sort()).toEqual(["Accepted", "Proposed"]);

    // No status field: a single category becomes the facet (e.g. a recipe catalog).
    const catalog = fixture({
      product: { name: "Recipe Box", description: "Save recipes.", tagline: "Cook well.", targetUser: "Home cooks", genome: "catalog", accent: "#4f46e5" },
      entities: [{
        name: "recipe", plural: "recipes", primaryField: "title",
        fields: [
          { id: "title", label: "Title", type: "text", required: true },
          { id: "meal", label: "Meal", type: "category", required: true, options: ["Breakfast", "Lunch", "Dinner"], allowCustom: false },
        ],
      }],
      filters: [], calculations: [{ id: "total", label: "Total recipes", operation: "count" }],
      capabilities: { create: true, edit: true, delete: true, search: true, filter: true, sort: false, group: false, transition: false, calculate: true },
    });
    const normalizedCatalog = normalizeProductIR(validateProductIR(catalog));
    expect(normalizedCatalog.filters.map((filter) => filter.value).sort()).toEqual(["Breakfast", "Dinner", "Lunch"]);
  });

  it("coerces synonym field types (select/dropdown/toggle) instead of failing the compile", () => {
    const raw = fixture();
    raw.entities[0]!.fields[2] = { id: "genre", label: "Genre", type: "select" as unknown as ProductIR["entities"][number]["fields"][number]["type"], required: true, options: ["Novel", "Cookbook", "Reference"] };
    const ir = normalizeProductIR(validateProductIR(raw));
    const genre = ir.entities[0].fields.find((field) => field.id === "genre");
    expect(genre?.type).toBe("category");
    // Coercion also lets the compiler derive per-option filters/counts for it.
    expect(ir.filters).toContainEqual(expect.objectContaining({ field: "genre", operator: "equals", value: "Novel" }));
  });

  it("tolerates a sparse IR (missing genome, required, and array fields) by defaulting", () => {
    const sparse = {
      version: "1",
      product: { name: "Book Shelf", targetUser: "A reader" },
      entities: [{ name: "book", plural: "books", fields: [
        { id: "title", label: "Title", type: "text" },
        { id: "genre", label: "Genre", type: "select", options: ["Novel", "Cookbook", "Reference"] },
      ] }],
    };
    const ir = normalizeProductIR(validateProductIR(sparse));
    expect(ir.product.genome).toBe("tracker");
    expect(ir.entities[0].primaryField).toBe("title"); // omitted primary falls back safely
    expect(ir.entities[0].fields[0]!.required).toBe(true); // primary is always required
    expect(ir.entities[0].fields[1]!.required).toBe(false); // omitted required defaults to false
    expect(ir.entities[0].fields[1]!.type).toBe("category"); // "select" coerced
    expect(ir.entities[0].fields[1]!.allowCustom).toBe(true); // category with options accepts custom input
    expect(ir.capabilities.create).toBe(true);
    expect(Array.isArray(ir.customRequirements)).toBe(true);
    expect(classifyCapabilities(ir).route).toBe("compile");
  });

  it("compiles FIFO priority as a deterministic ordered queue", () => {
    const waitlist = fixture({
      entities: [{
        name: "group", plural: "groups", primaryField: "name", fields: [
          { id: "name", label: "Name", type: "text", required: true },
          { id: "arrived_at", label: "Arrived at", type: "datetime", required: true },
          { id: "status", label: "Status", type: "status", required: true, options: ["Waiting", "Seated", "Left"] },
        ],
      }],
      priority: { label: "Next up", sortField: "arrived_at", direction: "asc", filter: { field: "status", operator: "equals", value: "Waiting" } },
      customRequirements: [],
    });
    const ir = normalizeProductIR(validateProductIR(waitlist));
    const config = compileConfig(ir);
    expect(classifyCapabilities(ir).route).toBe("compile");
    expect(config.priority).toEqual(waitlist.priority);
    expect(config.sorts[0]).toMatchObject({ id: "priority", field: "arrived_at", direction: "asc", type: "datetime" });
    expect(deriveJourneys(ir).map((journey) => journey.id)).toContain("priority");
  });

  it("normalizes duplicate identifiers and rejects malformed IR", () => {
    const duplicate = fixture();
    duplicate.entities[0]!.fields[1]!.id = "title";
    const normalized = normalizeProductIR(validateProductIR(duplicate));
    expect(new Set(normalized.entities[0].fields.map((field) => field.id)).size).toBe(normalized.entities[0].fields.length);
    expect(() => validateProductIR({ version: "1" })).toThrow(ProductIRValidationError);
  });

  it("infers a compact design intent and resolves every genome to a distinct local layout", () => {
    const familyPlanner = fixture({
      product: {
        name: "Family Rhythm",
        description: "Coordinate activities for parents and kids.",
        tagline: "One calm family plan.",
        targetUser: "Parents with two kids",
        genome: "planner",
      },
    });
    const normalized = normalizeProductIR(validateProductIR(familyPlanner));
    expect(normalized.product.design).toEqual({ tone: "playful", density: "comfortable", contrast: "balanced", motion: "subtle" });
    expect(compileConfig(normalized).design).toMatchObject({ layout: "agenda-canvas", tone: "playful" });

    const layouts = (["tracker", "workflow", "catalog", "planner", "dashboard"] as const)
      .map((genome) => resolveDesign(genome, normalized.product.design).layout);
    expect(new Set(layouts).size).toBe(5);
  });

  it("compiles one authoritative presentation and corrects obvious generic-genome mismatches", () => {
    const simpleFields: ProductIR["entities"][number]["fields"] = [
      { id: "title", label: "Title", type: "text" as const, required: true },
      { id: "owner", label: "Owner", type: "text" as const, required: false },
    ];
    const make = (product: ProductIR["product"], fields = simpleFields, calculations: ProductIR["calculations"] = []) => normalizeProductIR(validateProductIR(fixture({
      product,
      entities: [{ name: "item", plural: "items", primaryField: "title", fields }],
      capabilities: { create: true, edit: true, delete: true, search: true, filter: false, sort: true, group: false, transition: false, calculate: calculations.length > 0 },
      filters: [], calculations, charts: [],
    })));

    const products = [
      make({ name: "Simple Tracker", description: "Track a short list.", tagline: "", targetUser: "One person", genome: "tracker" }),
      make({ name: "Dense Registry", description: "Maintain detailed records.", tagline: "", targetUser: "Operations", genome: "tracker" }, Array.from({ length: 7 }, (_, index) => ({ id: index === 0 ? "title" : `field_${index}`, label: `Field ${index}`, type: "text" as const, required: index === 0 }))),
      make({ name: "Community Center Activities", description: "Plan upcoming activities, classes, and events.", tagline: "", targetUser: "Coordinator", genome: "tracker" }, [...simpleFields, { id: "date", label: "Date", type: "date" as const, required: true }]),
      make({ name: "Recipe Library", description: "Browse saved recipes.", tagline: "", targetUser: "Home cooks", genome: "catalog" }),
      make({ name: "Operations Pulse", description: "Monitor business performance.", tagline: "", targetUser: "Managers", genome: "dashboard" }, simpleFields, [{ id: "total", label: "Total", operation: "count" }]),
    ];
    const presentations = products.map((ir) => compileConfig(ir));
    expect(presentations.map((config) => config.presentation.primary)).toEqual(["tracker", "table", "agenda", "gallery", "dashboard"]);
    expect(presentations[2]!.presentation).toMatchObject({ dateField: "date", reason: "date-centered planning by date" });
    expect(presentations[2]!.sorts.find((sort) => sort.id === "by_date")).toMatchObject({ direction: "asc" });
    expect(new Set(presentations.map((config) => config.design.layout)).size).toBe(5);
    for (const config of presentations) expect(config.design.layout).not.toBe("");
  });

  it("selects presentation variants deterministically without model calls", () => {
    const variants = Array.from({ length: 40 }, (_, index) => {
      const raw = fixture({
        product: { name: `Focus Log ${index}`, description: "Track a short list.", tagline: "", targetUser: "One person", genome: "tracker" },
        entities: [{ name: "item", plural: "items", primaryField: "title", fields: [{ id: "title", label: "Title", type: "text", required: true }] }],
        capabilities: { create: true, edit: true, delete: true, search: true, filter: false, sort: true, group: false, transition: false, calculate: false },
        filters: [], calculations: [], charts: [],
      });
      return resolvePresentation(normalizeProductIR(validateProductIR(raw))).variant;
    });
    expect(new Set(variants)).toEqual(new Set(["timeline", "checklist", "milestones"]));
    const repeated = fixture({
      product: { name: "Focus Log 0", description: "Track a short list.", tagline: "", targetUser: "One person", genome: "tracker" },
      entities: [{ name: "item", plural: "items", primaryField: "title", fields: [{ id: "title", label: "Title", type: "text", required: true }] }],
      capabilities: { create: true, edit: true, delete: true, search: true, filter: false, sort: true, group: false, transition: false, calculate: false },
      filters: [], calculations: [], charts: [],
    });
    expect(resolvePresentation(normalizeProductIR(validateProductIR(repeated))).variant).toBe(variants[0]);
  });

  it("accepts explicit design enums and rejects unbounded visual instructions", () => {
    const designed = fixture({
      product: {
        ...fixture().product,
        design: { tone: "bold", density: "spacious", contrast: "high", motion: "expressive" },
      },
    });
    const normalized = normalizeProductIR(validateProductIR(designed));
    expect(normalized.product.design).toEqual(designed.product.design);
    expect(compileConfig(normalized).design).toMatchObject({ tone: "bold", density: "spacious", contrast: "high", motion: "expressive" });

    const malformed = structuredClone(designed) as unknown as { product: { design: { tone: string } } };
    malformed.product.design.tone = "generate-arbitrary-css";
    expect(() => validateProductIR(malformed)).toThrow(ProductIRValidationError);
  });

  it("keeps every curated palette variant above WCAG AA text contrast", () => {
    // Sweep many seeds per tone so every palette variant the hash can select is exercised.
    for (const tone of ["calm", "playful", "professional", "bold", "warm", "technical"] as const) {
      for (let seed = 0; seed < 40; seed += 1) {
        const design = resolveDesign("tracker", { tone, density: "comfortable", contrast: "balanced", motion: "subtle" }, `seed-${seed}`);
        expect(contrastRatio(design.colors.accent, design.colors.accentText)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(design.colors.ink, design.colors.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("diversifies design deterministically by product name without changing genome layout", () => {
    const intent = { tone: "calm", density: "comfortable", contrast: "balanced", motion: "subtle" } as const;
    // Same name → identical design (reproducible runs, no randomness).
    expect(resolveDesign("tracker", intent, "Reading List")).toEqual(resolveDesign("tracker", intent, "Reading List"));
    // Different names of the same genome+tone → visibly different looks.
    const names = ["Reading List", "Habit Log", "Plant Care", "Recipe Box", "Expense Notes", "Trip Planner", "Gear Locker", "Study Queue"];
    const looks = names.map((name) => {
      const d = resolveDesign("tracker", intent, name);
      return JSON.stringify([d.colors.accent, d.typography.display, d.shape.cardRadius, d.variant]);
    });
    expect(new Set(looks).size).toBeGreaterThan(1);
    // Layout stays genome-driven regardless of name.
    for (const name of names) expect(resolveDesign("tracker", intent, name).layout).toBe("progress-workbench");
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

  it("does not turn a filterable category into grouped boxes unless grouping was requested", () => {
    const raw = fixture({
      product: { name: "Home Library", description: "Keep every book in one list and filter what is lent out.", targetUser: "A reader", genome: "tracker" },
      entities: [{
        name: "book", plural: "books", primaryField: "title",
        fields: [
          { id: "title", label: "Title", type: "text", required: true },
          { id: "category", label: "Category", type: "category", required: false, options: ["Novel", "Reference", "Cookbook", "History", "Science"] },
        ],
      }],
      capabilities: { ...fixture().capabilities, filter: false, group: false, calculate: false },
      filters: [], calculations: [],
    });
    const ir = normalizeProductIR(validateProductIR(raw));
    const config = compileConfig(ir);

    expect(ir.capabilities).toMatchObject({ filter: true, calculate: true, group: false });
    expect(config.presentation).toMatchObject({ primary: "tracker", reason: "focused record tracking" });
    expect(config.presentation.groupField).toBeUndefined();
    expect(config.filters).toHaveLength(5);
  });

  it("normalizes and compiles conditional field visibility", () => {
    const conditional = fixture();
    conditional.entities[0]!.fields[3]!.visibleWhen = { field: "status", equals: "Accepted" };
    const ir = normalizeProductIR(validateProductIR(conditional));
    expect(ir.entities[0].fields[3]?.visibleWhen).toEqual({ field: "status", equals: "Accepted" });
    expect(compileConfig(ir).fields[3]).toMatchObject({
      key: "rationale",
      visibleWhen: { field: "status", equals: "Accepted" },
    });

    conditional.entities[0]!.fields[3]!.visibleWhen = { field: "missing", equals: "Accepted" };
    const normalizedInvalid = normalizeProductIR(validateProductIR(conditional));
    expect(normalizedInvalid.entities[0].fields[3]?.visibleWhen).toBeUndefined();
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
