import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, chartSeries, compareRecordsBySort, computeDerivedValue, computeSummaryValue, matchesPredicate, matchesRecordPredicate, withDerivedValues } from "./App.js";
import { type ChartConfig, type FieldConfig, type FilterPreset, productConfig, type SortOption, type SummaryConfig } from "./product-config.js";
import { createRepository, storageKeyFor } from "./repository.js";
import { resolveViewPlan } from "./view-plan.js";

beforeEach(() => { window.localStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true)); });
afterEach(cleanup);

const requiredValue = (type: string) => type === "email" ? "person@example.com" : type === "url" ? "https://example.com" : type === "number" || type === "currency" ? "12" : type === "date" ? "2026-08-17" : type === "datetime" ? "2026-08-17T10:00" : "Sample value";
// A number/currency field carries its own min/max, so the canonical sample (12)
// can violate the field's constraints (e.g. a weight with min 20). Clamp the
// sample into the field's declared range so create is never blocked by a bound
// the product legitimately set — the journey exercises create, not validation.
const sampleValue = (field: { type: string; min?: number; max?: number }) => {
  if (field.type !== "number" && field.type !== "currency") return requiredValue(field.type);
  let n = 12;
  if (typeof field.min === "number" && n < field.min) n = field.min;
  if (typeof field.max === "number" && n > field.max) n = field.max;
  return String(n);
};

async function fillField(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, field: FieldConfig, value: string | boolean) {
  const control = dialog.querySelector<HTMLElement>(`#field-${field.key}`);
  if (!control) return;
  if (field.type === "boolean") {
    if (Boolean(value) !== (control as HTMLInputElement).checked) await user.click(control);
  } else if (field.options?.length) {
    if (field.options.includes(String(value))) await user.selectOptions(control, String(value));
    else if (field.allowCustom) {
      await user.selectOptions(control, "__custom__");
      await user.type(within(dialog).getByRole("textbox", { name: `Custom ${field.label}` }), String(value));
    }
  } else {
    await user.clear(control);
    if (String(value) !== "") await user.type(control, String(value));
  }
}

async function createRecord(overrides: Record<string, string | boolean> = {}) {
  const user = userEvent.setup();
  const created: Record<string, string | boolean> = {};
  await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
  const dialog = screen.getByRole("dialog");
  for (const field of productConfig.fields.filter((candidate) => !candidate.derive)) {
    // Query by the runtime's deterministic control id: label-based regex queries
    // throw when one product label is a substring of another.
    const value = overrides[field.key] ?? field.options?.[0] ?? sampleValue(field);
    await fillField(user, dialog, field, value);
    created[field.key] = value;
  }
  await user.click(within(dialog).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
  return created;
}

function findMatchingFilter(filters: FilterPreset[], values: Record<string, string | boolean>): FilterPreset | undefined {
  return filters.find((preset) => matchesRecordPredicate({ values }, preset));
}

function recordContainerFor(primaryValue: string): HTMLElement {
  const match = screen.getAllByText(primaryValue)
    .map((element) => element.closest<HTMLElement>("[data-record-id]"))
    .find((element): element is HTMLElement => Boolean(element));
  expect(match, `A rendered record should contain ${primaryValue}`).toBeDefined();
  return match!;
}

function nonMatchingEditableValue(field: FieldConfig, preset: FilterPreset, values: Record<string, string | boolean>): string | boolean | undefined {
  const rangeRule = productConfig.rangeConflicts.find((rule) => rule.startField === field.key || rule.endField === field.key);
  const dateCandidates = field.type === "date" || field.type === "datetime"
    ? (rangeRule?.endField === field.key ? ["2099-01-01"] : ["2000-01-01"])
    : [];
  const candidates: Array<string | boolean> = [
    ...(field.options ?? []),
    ...dateCandidates,
    ...(field.required ? [] : [""]),
    ...(field.type === "number" || field.type === "currency" ? ["0", "999999"] : ["Different value"]),
    false, true,
  ];
  return candidates.find((candidate) => candidate !== values[field.key]
    && !matchesRecordPredicate({ values: { ...values, [field.key]: candidate } }, preset));
}

describe("compiled product runtime", () => {
  it("applies the compiled local design profile without changing product behavior", () => {
    const { container } = render(<App />);
    const app = container.firstElementChild;
    expect(app).toHaveAttribute("data-layout", productConfig.design.layout);
    expect(app).toHaveAttribute("data-tone", productConfig.design.tone);
    expect(app).toHaveAttribute("data-density", productConfig.design.density);
    expect(app).toHaveAttribute("data-view", resolveViewPlan(productConfig).primary);
    expect(app).toHaveAttribute("data-presentation-variant", productConfig.presentation.variant);
    expect(app).toHaveStyle(`--accent: ${productConfig.design.colors.accent}`);
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main");
  });

  it("renders the compiled presentation with its own structural collection", async () => {
    const { container } = render(<App />);
    await createRecord();
    const structuralClass = {
      tracker: ".tracker-view", table: ".table-view", board: ".board-view",
      gallery: ".gallery-view", agenda: ".agenda-view", dashboard: ".dashboard-view",
      standings: ".standings-roster",
    }[productConfig.presentation.primary];
    expect(container.querySelector(structuralClass)).not.toBeNull();
  });

  it("exposes storage through a swappable repository factory", () => {
    const bundle = createRepository("Integration Ready Product");
    expect(window.localStorage.getItem(storageKeyFor("Integration Ready Product"))).toBeNull();
    const created = bundle.repository.create({ [productConfig.primaryField]: "Seam check" });
    expect(bundle.repository.list()).toHaveLength(1);
    // A fresh bundle over the same name rehydrates from the persisted backend,
    // proving the UI depends only on the interface, not on module-level state.
    const rehydrated = createRepository("Integration Ready Product");
    expect(rehydrated.repository.list().map((record) => record.id)).toContain(created.id);
    expect(rehydrated.recoveredFromInvalidData).toBe(false);
  });

  it("recovers from corrupt storage and keeps mutations atomic when persistence fails", () => {
    const key = storageKeyFor("Corrupt Product");
    window.localStorage.setItem(key, "{not-json");
    const recovered = createRepository("Corrupt Product");
    expect(recovered.recoveredFromInvalidData).toBe(true);
    expect(recovered.repository.list()).toEqual([]);

    const failingStorage = {
      get length() { return 0; }, clear: vi.fn(), getItem: vi.fn(() => null), key: vi.fn(() => null), removeItem: vi.fn(),
      setItem: vi.fn(() => { throw new DOMException("quota", "QuotaExceededError"); }),
    } satisfies Storage;
    const unavailable = createRepository("Atomic Product", failingStorage);
    expect(() => unavailable.repository.create({ title: "Unsaved" })).toThrow(/quota/i);
    expect(unavailable.repository.list()).toEqual([]);
  });

  it("honours the full repository update, remove, restore, and clear contract", () => {
    const { repository } = createRepository("Repository Contract");
    const created = repository.create({ title: "First" });
    expect(repository.update(created.id, { title: "Updated" }).values.title).toBe("Updated");
    repository.remove(created.id);
    expect(repository.list()).toEqual([]);
    repository.restore(created);
    repository.restore(created);
    expect(repository.list()).toHaveLength(1);
    expect(() => repository.update("missing", { title: "Nope" })).toThrow(/no longer exists/i);
    repository.clear();
    expect(repository.list()).toEqual([]);
  });

  it("lets the user switch to a dark theme and remembers the choice", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    const app = view.container.firstElementChild as HTMLElement;
    expect(app).toHaveStyle(`--canvas: ${productConfig.design.colors.canvas}`);
    const toggle = screen.getByRole("button", { name: /theme:/i });
    // system → light → dark: cycle until the dark surface ramp is applied.
    for (let index = 0; index < 3 && document.documentElement.dataset.theme !== "dark"; index += 1) {
      await user.click(toggle);
    }
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(app).toHaveStyle("--canvas: #0d1117");
    // The compiled brand accent survives the theme switch.
    expect(app).toHaveStyle(`--accent: ${productConfig.design.colors.accent}`);
    expect(window.localStorage.getItem("agent-cofounder:theme")).toBe("dark");
  });

  it("makes configured choices explicit and supports a custom choice", async () => {
    const user = userEvent.setup();
    const configurable = productConfig.fields.find((field) => field.options?.length && field.allowCustom);
    // Not every product needs a custom-choice category. When one exists it must
    // work; its absence is a valid configuration, not a failure to repair.
    if (!configurable) return;
    render(<App />);
    await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
    const choice = screen.getByRole("dialog").querySelector<HTMLElement>(`#field-${configurable!.key}`)!;
    expect(choice).toBeInTheDocument();
    for (const option of configurable!.options!) expect(within(choice).getByRole("option", { name: option })).toBeInTheDocument();
    await user.selectOptions(choice, within(choice).getByRole("option", { name: "Other…" }));
    const custom = within(screen.getByRole("dialog")).getByRole("textbox", { name: `Custom ${configurable!.label}` });
    await user.type(custom, "Custom choice");
    expect(custom).toHaveValue("Custom choice");
    for (const field of productConfig.fields.filter((candidate) => candidate.required && candidate.key !== configurable.key)) {
      await fillField(user, screen.getByRole("dialog"), field, field.options?.[0] ?? sampleValue(field));
    }
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
    const stored = JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]");
    expect(stored[0].values[configurable.key]).toBe("Custom choice");
    cleanup();
    render(<App />);
    expect(JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]")[0].values[configurable.key]).toBe("Custom choice");
  });

  it("focuses the first invalid field after a blocked submission", async () => {
    const user = userEvent.setup();
    const firstRequired = productConfig.fields.find((field) => field.required)!;
    render(<App />);
    await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
    expect(within(dialog).getByText(`${firstRequired.label} is required.`)).toBeInTheDocument();
    expect(document.getElementById(`field-${firstRequired.key}`)).toHaveFocus();
  });

  it("shows only fields whose visibility condition matches", async () => {
    // Fixture keys/labels are deliberately implausible so they can never collide
    // with a real compiled product's field labels (a "Schedule Type" collision
    // once made every journey report as failed).
    const originalFields = productConfig.fields;
    productConfig.fields = [
      ...originalFields,
      { key: "qa_visibility_controller", label: "QA Visibility Controller", type: "category", required: true, options: ["QA Branch A", "QA Branch B"], allowCustom: false },
      { key: "qa_branch_a_detail", label: "QA Branch A Detail", type: "category", required: false, options: ["QA Option"], allowCustom: false, visibleWhen: { field: "qa_visibility_controller", equals: "QA Branch A" } },
      { key: "qa_branch_b_detail", label: "QA Branch B Detail", type: "category", required: false, options: ["QA Option"], allowCustom: false, visibleWhen: { field: "qa_visibility_controller", equals: "QA Branch B" } },
    ];
    const user = userEvent.setup();
    const view = render(<App />);
    try {
      await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).queryByRole("combobox", { name: "QA Branch A Detail" })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("combobox", { name: "QA Branch B Detail" })).not.toBeInTheDocument();
      await user.selectOptions(within(dialog).getByRole("combobox", { name: "QA Visibility Controller" }), "QA Branch A");
      expect(within(dialog).getByRole("combobox", { name: "QA Branch A Detail" })).toBeInTheDocument();
      expect(within(dialog).queryByRole("combobox", { name: "QA Branch B Detail" })).not.toBeInTheDocument();
      await user.selectOptions(within(dialog).getByRole("combobox", { name: "QA Visibility Controller" }), "QA Branch B");
      expect(within(dialog).queryByRole("combobox", { name: "QA Branch A Detail" })).not.toBeInTheDocument();
      expect(within(dialog).getByRole("combobox", { name: "QA Branch B Detail" })).toBeInTheDocument();
    } finally {
      view.unmount();
      productConfig.fields = originalFields;
    }
  });

  it("derives a dateThreshold field into overdue, due soon, and fine bands from today", () => {
    // A computed status field: bucket a record by how its elapsed days since a
    // reference date compare to a per-record threshold. This is the deterministic
    // path that replaces a hand-written custom patch.
    const field: FieldConfig = {
      key: "qa_derived_status", label: "QA Derived Status", type: "status",
      derive: { kind: "dateThreshold", dateField: "qa_last", thresholdField: "qa_every", soonWithinDays: 2, buckets: { overdue: "Overdue", soon: "Due soon", ok: "Fine" } },
    };
    const now = new Date(Date.UTC(2026, 7, 22));
    expect(computeDerivedValue(field, { qa_last: "2026-08-12", qa_every: "7" }, now)).toBe("Overdue"); // 10 days elapsed > 7
    expect(computeDerivedValue(field, { qa_last: "2026-08-16", qa_every: "7" }, now)).toBe("Due soon"); // due in 1 day, within 2
    expect(computeDerivedValue(field, { qa_last: "2026-08-21", qa_every: "7" }, now)).toBe("Fine"); // due in 6 days
    expect(computeDerivedValue(field, { qa_every: "7" }, now)).toBe(""); // no reference date → no band
    const fixed: FieldConfig = { ...field, derive: { kind: "dateThreshold", dateField: "qa_last", thresholdDays: 30, buckets: { overdue: "Overdue", soon: "Due soon", ok: "Fine" } } };
    expect(computeDerivedValue(fixed, { qa_last: "2026-06-01" }, now)).toBe("Overdue"); // long past a fixed 30-day span
  });

  it("computes a formula derived field with arithmetic over other numeric fields", () => {
    const now = new Date(Date.UTC(2026, 7, 22));
    const remaining: FieldConfig = { key: "remaining", label: "Remaining", type: "currency", derive: { kind: "formula", expression: "target - current" } };
    const oneRepMax: FieldConfig = { key: "one_rep_max", label: "1RM", type: "number", derive: { kind: "formula", expression: "weight * (1 + reps / 30)" } };
    expect(computeDerivedValue(remaining, { target: "1000", current: "250" }, now)).toBe(750);
    expect(computeDerivedValue(oneRepMax, { weight: "100", reps: "5" }, now)).toBe(116.67); // 100*(1+5/30)=116.666… → rounded
    expect(computeDerivedValue(remaining, { target: "1000" }, now)).toBe(""); // missing input → no value, not a spurious 1000
    const bad: FieldConfig = { key: "bad", label: "Bad", type: "number", derive: { kind: "formula", expression: "current / 0" } };
    expect(computeDerivedValue(bad, { current: "5" }, now)).toBe(""); // non-finite → no value
  });

  it("derives a presence status from whether the source field is filled in", () => {
    // A two-state lifecycle computed from another field's presence: the book is
    // "Lent out" exactly when a borrower is recorded, otherwise "On shelf". The
    // status can never drift from the borrower because it is never stored.
    const now = new Date(Date.UTC(2026, 7, 22));
    const status: FieldConfig = {
      key: "status", label: "Status", type: "status", options: ["On shelf", "Lent out"],
      derive: { kind: "presence", sourceField: "borrower", whenPresent: "Lent out", whenEmpty: "On shelf" },
    };
    expect(computeDerivedValue(status, { borrower: "prabhu" }, now)).toBe("Lent out");
    expect(computeDerivedValue(status, { borrower: "" }, now)).toBe("On shelf"); // cleared on return → back on shelf
    expect(computeDerivedValue(status, { borrower: "   " }, now)).toBe("On shelf"); // whitespace-only is empty
    expect(computeDerivedValue(status, {}, now)).toBe("On shelf"); // no borrower key at all
  });

  it("derives reservation status from an inclusive range and completion override", () => {
    const status: FieldConfig = {
      key: "status", label: "Status", type: "status", options: ["Reserved", "Out", "Returned", "Cancelled"],
      derive: {
        kind: "rangeStatus", startField: "start", endField: "end", completedField: "returned",
        inactiveField: "cancelled",
        buckets: { upcoming: "Reserved", active: "Out", past: "Out", completed: "Returned", inactive: "Cancelled" },
      },
    };
    const now = new Date(2026, 8, 12, 12);
    expect(computeDerivedValue(status, { start: "2026-09-13", end: "2026-09-15" }, now)).toBe("Reserved");
    expect(computeDerivedValue(status, { start: "2026-09-12", end: "2026-09-12" }, now)).toBe("Out");
    expect(computeDerivedValue(status, { start: "2026-09-01", end: "2026-09-10" }, now)).toBe("Out");
    expect(computeDerivedValue(status, { start: "2026-09-01", end: "2026-09-20", returned: "2026-09-11" }, now)).toBe("Returned");
    expect(computeDerivedValue(status, { start: "2026-09-01", end: "2026-09-20", returned: "2026-09-11", cancelled: true }, now)).toBe("Cancelled");
  });

  it("counts a presence-derived status from stored records that only carry the source field", () => {
    // The reported bug: a book with a borrower recorded but no stored status was
    // counted as "On shelf", so "Lent out" showed 0. With status derived from the
    // borrower's presence, the count is computed from the borrower alone.
    const now = new Date(Date.UTC(2026, 7, 27));
    const status: FieldConfig = {
      key: "status", label: "Status", type: "status", options: ["On shelf", "Lent out"],
      derive: { kind: "presence", sourceField: "borrower", whenPresent: "Lent out", whenEmpty: "On shelf" },
    };
    const lentOut: SummaryConfig = { id: "lent", label: "Lent out", operation: "countWhere", field: "status", operator: "equals", value: "Lent out" };
    const onShelf: SummaryConfig = { id: "shelf", label: "On shelf", operation: "countWhere", field: "status", operator: "equals", value: "On shelf" };
    // Stored records never contain a `status` key — only what the user typed.
    const withStatus = (values: Record<string, string>) => ({ values: { ...values, status: computeDerivedValue(status, values, now) } });
    const records = [withStatus({ borrower: "prabhu" }), withStatus({ borrower: "" })];
    expect(computeSummaryValue(lentOut, records, now)).toBe(1); // the borrowed book, not 0
    expect(computeSummaryValue(onShelf, records, now)).toBe(1);
  });

  it("matches a date field against today, this week, and this month windows", () => {
    const now = new Date(Date.UTC(2026, 7, 19)); // Wed 2026-08-19
    expect(matchesPredicate("2026-08-19", "today", undefined, now)).toBe(true);
    expect(matchesPredicate("2026-08-18", "today", undefined, now)).toBe(false);
    expect(matchesPredicate("2026-08-17", "thisWeek", undefined, now)).toBe(true); // Mon of that week
    expect(matchesPredicate("2026-08-23", "thisWeek", undefined, now)).toBe(true); // Sun of that week
    expect(matchesPredicate("2026-08-16", "thisWeek", undefined, now)).toBe(false); // prior Sun
    expect(matchesPredicate("2026-08-01", "thisMonth", undefined, now)).toBe(true);
    expect(matchesPredicate("2026-07-31", "thisMonth", undefined, now)).toBe(false);
    expect(matchesPredicate("", "thisMonth", undefined, now)).toBe(false);
    expect(matchesPredicate("2026-08-20", "after", "today", now)).toBe(true);
    expect(matchesPredicate("2026-08-18", "after", "today", now)).toBe(false);
  });

  it("resolves another field as a per-record comparison bound", () => {
    const base = { id: "stock", createdAt: "", updatedAt: "", values: { units_on_hand: 3, reorder_level: 5 } };
    const lowStock = { field: "units_on_hand", operator: "atMost" as const, value: "reorder_level" };
    expect(matchesRecordPredicate(base, lowStock)).toBe(true);
    expect(matchesRecordPredicate({ ...base, values: { ...base.values, units_on_hand: 8 } }, lowStock)).toBe(false);
  });

  it("supports excluding two terminal values with one priority predicate", () => {
    expect(matchesPredicate("Screening", "notEquals", "Hired", new Date(), "Rejected")).toBe(true);
    expect(matchesPredicate("Hired", "notEquals", "Hired", new Date(), "Rejected")).toBe(false);
    expect(matchesPredicate("Rejected", "notEquals", "Hired", new Date(), "Rejected")).toBe(false);
  });

  it("selects a filter from projected values instead of assuming the first filter matches", () => {
    const filters: FilterPreset[] = [
      { id: "on_shelf", label: "On shelf", field: "status", operator: "equals", value: "On shelf" },
      { id: "lent_out", label: "Lent out", field: "status", operator: "equals", value: "Lent out" },
    ];
    expect(findMatchingFilter(filters, { status: "Lent out" })?.id).toBe("lent_out");
  });

  it("totals a per-category spend breakdown as a grouped sum (sumWhere)", () => {
    const records = [
      { values: { amount: "120", category: "Food", date: "2026-08-10" } },
      { values: { amount: "30", category: "Food", date: "2026-08-11" } },
      { values: { amount: "900", category: "Rent", date: "2026-07-01" } },
    ];
    const now = new Date(Date.UTC(2026, 7, 19));
    const foodSpend: SummaryConfig = { id: "food", label: "Food", operation: "sumWhere", field: "category", operator: "equals", value: "Food", sumField: "amount" };
    const rentSpend: SummaryConfig = { ...foodSpend, id: "rent", label: "Rent", value: "Rent" };
    const total: SummaryConfig = { id: "total", label: "Total", operation: "sum", field: "amount" };
    const spentThisMonth: SummaryConfig = { id: "mtd", label: "Spent this month", operation: "sumWhere", field: "date", operator: "thisMonth", sumField: "amount" };
    expect(computeSummaryValue(foodSpend, records, now)).toBe(150); // 120 + 30, not a count of 2
    expect(computeSummaryValue(rentSpend, records, now)).toBe(900);
    expect(computeSummaryValue(total, records, now)).toBe(1050);
    expect(computeSummaryValue(spentThisMonth, records, now)).toBe(150); // Rent was in July
  });

  it("builds a chart series sorted chronologically, skipping records missing either axis", () => {
    const chart: ChartConfig = { id: "weight_trend", label: "Weight over time", type: "line", xField: "date", yField: "weight" };
    const records = [
      { values: { date: "2026-08-11", weight: "81.2" } },
      { values: { date: "2026-08-09", weight: "82.0" } },
      { values: { date: "", weight: "80.0" } },          // no date → skipped
      { values: { date: "2026-08-13", weight: "" } },      // no number → skipped
      { values: { date: "2026-08-10", weight: "81.6" } },
    ];
    const series = chartSeries(chart, records);
    expect(series.map((point) => point.y)).toEqual([82.0, 81.6, 81.2]); // ordered by date asc
    expect(series).toHaveLength(3);
  });

  it("sorts by a chosen field option — numeric for currency, textual otherwise, honouring direction", () => {
    const originalSorts = productConfig.sorts;
    productConfig.sorts = [
      { id: "updated", label: "Recently updated" },
      { id: "by_amount", label: "By amount", field: "amount", direction: "desc", type: "currency" },
      { id: "by_name", label: "By name", field: "name", direction: "asc", type: "text" },
    ] satisfies SortOption[];
    try {
      const rec = (values: Record<string, string>, at = "2026-08-01") => ({ values, createdAt: at, updatedAt: at });
      const low = rec({ amount: "30", name: "Bravo" });
      const high = rec({ amount: "120", name: "Alpha" });
      // By amount, descending: the larger amount sorts first (comparing 120 vs 30 numerically, not "120" < "30").
      expect(compareRecordsBySort("by_amount", low, high)).toBeGreaterThan(0);
      expect(compareRecordsBySort("by_amount", high, low)).toBeLessThan(0);
      // By name, ascending: Alpha before Bravo.
      expect(compareRecordsBySort("by_name", low, high)).toBeGreaterThan(0);
      // Recently updated: the newer timestamp sorts first.
      expect(compareRecordsBySort("updated", rec({}, "2026-01-01"), rec({}, "2026-02-01"))).toBeGreaterThan(0);
    } finally {
      productConfig.sorts = originalSorts;
    }
  });

  it("renders configured summaries as compact metrics", () => {
    render(<App />);
    // Headline summaries appear as stat tiles; a facet count that mirrors a
    // filter chip is shown as that chip's badge, not as a duplicate tile.
    const isFacet = (summary: (typeof productConfig.summaries)[number]) => productConfig.filters.some((preset) =>
      summary.operation === "countWhere"
      && summary.field === preset.field
      && String(summary.operator ?? "") === String(preset.operator ?? "")
      && String(summary.value ?? "") === String(preset.value ?? ""));
    for (const summary of productConfig.summaries.filter((candidate) => !isFacet(candidate))) {
      expect(screen.getAllByText(summary.label).length).toBeGreaterThan(0);
    }
  });

  it("validates required input and supports create, persistence, edit, search, and delete", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
    expect(screen.getAllByText(/is required/i).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /close/i }));

    const editableFilter = productConfig.filters.find((preset) => !productConfig.fields.find((field) => field.key === preset.field)?.derive);
    const filterOverrides: Record<string, string | boolean> = {};
    if (editableFilter) {
      const field = productConfig.fields.find((candidate) => candidate.key === editableFilter.field);
      if (editableFilter.operator === "equals") filterOverrides[editableFilter.field] = editableFilter.value ?? field?.options?.[0] ?? "Matched";
      else if (editableFilter.operator === "nonEmpty") filterOverrides[editableFilter.field] = field?.options?.[0] ?? "Matched";
      else if (editableFilter.operator === "empty") filterOverrides[editableFilter.field] = "";
      else if (editableFilter.operator === "truthy") filterOverrides[editableFilter.field] = true;
      else if (editableFilter.operator === "falsy") filterOverrides[editableFilter.field] = false;
      else if (["today", "thisWeek", "thisMonth"].includes(editableFilter.operator)) {
        const now = new Date();
        filterOverrides[editableFilter.field] = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      }
    }
    const created = await createRecord(filterOverrides);
    const primaryValue = String(created[productConfig.primaryField]);
    expect(screen.getAllByText(primaryValue).length).toBeGreaterThan(0);
    const storedAfterCreate = JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]");
    expect(storedAfterCreate).toHaveLength(1);
    const projectedAfterCreate = storedAfterCreate.map((record: { values: Record<string, string | boolean> }) => ({
      ...record,
      values: withDerivedValues(record.values),
    }));
    const projectedCreated = projectedAfterCreate[0]!.values;
    // A facet count that mirrors a filter chip is shown as the chip's badge,
    // not as a duplicate stat tile.
    const isFacetChip = (summary: SummaryConfig) => productConfig.filters.some((preset) =>
      summary.operation === "countWhere"
      && summary.field === preset.field
      && String(summary.operator ?? "") === String(preset.operator ?? "")
      && String(summary.value ?? "") === String(preset.value ?? ""));
    // The compiler renders the stat strip only when at least one non-facet
    // summary remains after facet counts move to their filter chips. When every
    // summary is a facet chip the strip is omitted entirely, so the labelled
    // region legitimately does not exist.
    const tileSummaries = productConfig.summaries.filter((summary) => !isFacetChip(summary));
    const summaryRegion = document.querySelector<HTMLElement>(".stat-strip[aria-label='Summary']");
    if (tileSummaries.length === 0) {
      expect(summaryRegion).toBeNull();
    } else {
      expect(summaryRegion).toBeInTheDocument();
      for (const summary of productConfig.summaries) {
        // Visible labels may legitimately repeat (two different predicates can
        // share user-facing wording), so identity comes from the normalized IR id.
        const tile = summaryRegion!.querySelector<HTMLElement>(`[data-summary-id="${summary.id}"]`);
        if (isFacetChip(summary)) { expect(tile).toBeNull(); continue; }
        expect(tile).toBeInTheDocument();
        const rendered = tile!.querySelector("strong")!.textContent ?? "";
        const expected = computeSummaryValue(summary, projectedAfterCreate);
        if (summary.operation === "count" || summary.operation === "countWhere") expect(rendered).toBe(String(expected));
        else expect(Number(rendered.replace(/[^0-9.-]/gu, ""))).toBe(expected);
      }
    }
    for (const chart of productConfig.charts) {
      // Each chart type renders a distinct accessible figure. Categorical
      // charts (bar/pie) draw immediately; a line chart needs at least two
      // points to connect, so with a single created record it shows its
      // empty-state hint instead of a role="img" figure.
      if (chart.type === "pie") {
        expect(screen.getByRole("img", { name: `${chart.label} pie chart` })).toBeInTheDocument();
      } else if (chart.type === "bar") {
        expect(screen.getByRole("img", { name: `${chart.label} bar chart` })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("img", {
          name: (accessibleName) => accessibleName.startsWith(`${chart.label} line chart`),
        })).toBeNull();
        expect(screen.getAllByText("Add at least two dated entries to see this trend.").length).toBeGreaterThan(0);
      }
    }
    const groupField = productConfig.fields.find((field) => field.key === productConfig.presentation.groupField);
    if (groupField) {
      const groupLabel = String(projectedCreated[groupField.key] ?? "Uncategorized");
      expect(screen.getAllByRole("heading", { name: groupLabel }).length).toBeGreaterThan(0);
    }

    view.unmount();
    render(<App />);
    expect(screen.getAllByText(primaryValue).length).toBeGreaterThan(0);
    if (productConfig.capabilities.search) {
      await user.type(screen.getByRole("searchbox"), "no-match-value");
      expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
      await user.clear(screen.getByRole("searchbox"));
    }
    if (productConfig.filters.length > 0) {
      const preset = findMatchingFilter(productConfig.filters, projectedCreated);
      expect(preset, "At least one configured filter should match the projected record").toBeDefined();
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const filterGroup = within(screen.getByRole("group", { name: new RegExp(`filter ${escape(productConfig.entityNamePlural)}`, "i") }));
      await user.click(filterGroup.getByRole("button", { name: new RegExp(escape(preset!.label), "i"), pressed: false }));
      expect(screen.getAllByText(primaryValue).length).toBeGreaterThan(0);
      await user.click(filterGroup.getByRole("button", { name: new RegExp(`^all ${escape(productConfig.entityNamePlural)}`, "i") }));
    }
    await user.click(within(recordContainerFor(primaryValue)).getByRole("button", { name: /^edit$/i }));
    const editDialog = screen.getByRole("dialog");
    const primaryField = productConfig.fields.find((field) => field.key === productConfig.primaryField)!;
    const editedValue = primaryField.options?.find((option) => option !== primaryValue) ?? (primaryField.allowCustom ? "Edited custom value" : "Edited sample value");
    await fillField(user, editDialog, primaryField, editedValue);
    let editedFilterValue: string | boolean | undefined;
    if (editableFilter && editableFilter.field !== primaryField.key) {
      const filterField = productConfig.fields.find((field) => field.key === editableFilter.field)!;
      editedFilterValue = nonMatchingEditableValue(filterField, editableFilter, created);
      if (editedFilterValue !== undefined) await fillField(user, editDialog, filterField, editedFilterValue);
    }
    await user.click(within(editDialog).getByRole("button", { name: /save changes/i }));
    expect(screen.getAllByText(editedValue).length).toBeGreaterThan(0);
    const updatedStored = JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]");
    expect(updatedStored[0].values[productConfig.primaryField]).toBe(editedValue);
    if (editableFilter && editedFilterValue !== undefined) {
      expect(matchesRecordPredicate(updatedStored[0], editableFilter)).toBe(false);
    }
    cleanup();
    render(<App />);
    expect(screen.getAllByText(editedValue).length).toBeGreaterThan(0);
    await user.click(within(recordContainerFor(editedValue)).getByRole("button", { name: /^delete$/i }));
    expect(screen.getByText(new RegExp(`no ${productConfig.entityNamePlural}`, "i"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(screen.getAllByText(editedValue).length).toBeGreaterThan(0);
  });

  it("runs a configured quick action and persists the field change", async () => {
    if (productConfig.quickActions.length === 0) return; // no-op for products without quick actions
    const user = userEvent.setup();
    render(<App />);
    await createRecord();
    const action = productConfig.quickActions[0];
    // Capture the prior value so increment/toggle can be checked relative to it.
    const beforeStored = JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]");
    const prior = beforeStored[beforeStored.length - 1]?.values[action.field];
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const primaryValue = String(beforeStored[beforeStored.length - 1]?.values[productConfig.primaryField] ?? "");
    await user.click(within(recordContainerFor(primaryValue)).getByRole("button", { name: new RegExp(`^${escape(action.label)}$`, "i") }));
    const stored = JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]");
    const saved = stored[stored.length - 1];
    // Each verb persists a distinct outcome; mirror the runtime's runQuickAction.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    switch (action.set) {
      case "today":
      case "now":
        expect(String(saved.values[action.field]).startsWith(today)).toBe(true);
        break;
      case "increment":
        expect(Number(saved.values[action.field])).toBe((Number(prior) || 0) + (action.amount ?? 1));
        break;
      case "toggle":
        expect(saved.values[action.field]).toBe(!(prior === true || prior === "true"));
        break;
      case "setValue":
        expect(saved.values[action.field]).toBe(action.value ?? "");
        break;
      default: // clear
        expect(saved.values[action.field]).toBe("");
    }
  });

  it("shows availability and blocks an inclusive overlapping range for the same subject", async () => {
    const rule = productConfig.rangeConflicts[0];
    if (!rule) return;
    const user = userEvent.setup();
    render(<App />);
    const ignored = new Set((rule.ignoreWhen?.values ?? []).map((value) => value.toLowerCase()));
    const stateField = rule.ignoreWhen ? productConfig.fields.find((field) => field.key === rule.ignoreWhen?.field) : undefined;
    const activeState = stateField?.options?.find((option) => !ignored.has(option.toLowerCase())) ?? "Active";
    const completedField = stateField?.derive?.kind === "rangeStatus" ? stateField.derive.completedField : undefined;
    const inactiveField = stateField?.derive?.kind === "rangeStatus" ? stateField.derive.inactiveField : undefined;
    const shared = {
      [rule.matchField]: "Shared resource",
      [rule.startField]: "2026-10-10",
      [rule.endField]: "2026-10-12",
      ...(rule.ignoreWhen ? { [rule.ignoreWhen.field]: activeState } : {}),
      ...(completedField ? { [completedField]: "" } : {}),
      ...(inactiveField ? { [inactiveField]: false } : {}),
    };
    await createRecord(shared);
    expect(JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]")).toHaveLength(1);

    await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
    const dialog = screen.getByRole("dialog");
    for (const field of productConfig.fields.filter((candidate) => !candidate.derive)) {
      const value = shared[field.key as keyof typeof shared] ?? field.options?.[0] ?? sampleValue(field);
      await fillField(user, dialog, field, value);
    }
    // Touching the existing end date is an overlap because endpoints are inclusive.
    await fillField(user, dialog, productConfig.fields.find((field) => field.key === rule.startField)!, "2026-10-12");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/unavailable for this period/i);
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
    expect(JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]")).toHaveLength(1);
    expect(within(dialog).getByText(/choose different dates or another item/i)).toBeInTheDocument();

    // A different subject with the same dates becomes available and can be saved.
    await fillField(user, dialog, productConfig.fields.find((field) => field.key === rule.matchField)!, "Another resource");
    expect(within(dialog).getByRole("status")).toHaveTextContent(/available for this period/i);
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
    expect(JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]")).toHaveLength(2);
  });
});
