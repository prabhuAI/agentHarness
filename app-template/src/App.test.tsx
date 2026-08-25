import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, chartSeries, compareRecordsBySort, computeDerivedValue, computeSummaryValue, matchesPredicate, withDerivedValues } from "./App.js";
import { type ChartConfig, type FieldConfig, productConfig, type SortOption, type SummaryConfig } from "./product-config.js";
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
    for (const summary of productConfig.summaries) expect(screen.getAllByText(summary.label).length).toBeGreaterThan(0);
  });

  it("validates required input and supports create, persistence, edit, search, and delete", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
    expect(screen.getAllByText(/is required/i).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /close/i }));

    const firstFilter = productConfig.filters[0];
    const filterOverrides: Record<string, string | boolean> = {};
    if (firstFilter) {
      const field = productConfig.fields.find((candidate) => candidate.key === firstFilter.field);
      if (firstFilter.operator === "equals") filterOverrides[firstFilter.field] = firstFilter.value ?? field?.options?.[0] ?? "Matched";
      else if (firstFilter.operator === "nonEmpty") filterOverrides[firstFilter.field] = field?.options?.[0] ?? "Matched";
      else if (firstFilter.operator === "empty") filterOverrides[firstFilter.field] = "";
      else if (firstFilter.operator === "truthy") filterOverrides[firstFilter.field] = true;
      else if (firstFilter.operator === "falsy") filterOverrides[firstFilter.field] = false;
      else if (["today", "thisWeek", "thisMonth"].includes(firstFilter.operator)) {
        const now = new Date();
        filterOverrides[firstFilter.field] = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
    const summaryRegion = screen.getByLabelText("Summary");
    for (const summary of productConfig.summaries) {
      // Visible labels may legitimately repeat (two different predicates can
      // share user-facing wording), so identity comes from the normalized IR id.
      const tile = summaryRegion.querySelector<HTMLElement>(`[data-summary-id="${summary.id}"]`)!;
      expect(tile).toBeInTheDocument();
      const rendered = tile.querySelector("strong")!.textContent ?? "";
      const expected = computeSummaryValue(summary, projectedAfterCreate);
      if (summary.operation === "count" || summary.operation === "countWhere") expect(rendered).toBe(String(expected));
      else expect(Number(rendered.replace(/[^0-9.-]/gu, ""))).toBe(expected);
    }
    for (const chart of productConfig.charts) {
      expect(screen.getByRole("img", { name: `${chart.label} line chart with 1 points` })).toBeInTheDocument();
    }
    const groupField = productConfig.fields.find((field) => field.key === productConfig.presentation.groupField);
    if (groupField) {
      const groupLabel = String(created[groupField.key] ?? "Uncategorized");
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
      const preset = productConfig.filters[0];
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const filterGroup = within(screen.getByRole("group", { name: new RegExp(`filter ${escape(productConfig.entityNamePlural)}`, "i") }));
      await user.click(filterGroup.getByRole("button", { name: new RegExp(escape(preset.label), "i"), pressed: false }));
      // Predict the filter's effect with the runtime's own predicate rather than a
      // re-implementation: a hand-rolled version could not reason about date-window
      // operators (today/thisWeek/thisMonth), so a product whose first filter was a
      // date window was wrongly expected to still show the record and failed here.
      const matches = matchesPredicate(created[preset.field] as string | boolean | undefined, preset.operator, preset.value);
      expect(matches).toBe(true);
      expect(screen.getAllByText(primaryValue).length).toBeGreaterThan(0);
      await user.click(filterGroup.getByRole("button", { name: new RegExp(`^all ${escape(productConfig.entityNamePlural)}`, "i") }));
    }
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const editDialog = screen.getByRole("dialog");
    const primaryField = productConfig.fields.find((field) => field.key === productConfig.primaryField)!;
    const editedValue = primaryField.options?.find((option) => option !== primaryValue) ?? (primaryField.allowCustom ? "Edited custom value" : "Edited sample value");
    await fillField(user, editDialog, primaryField, editedValue);
    let editedFilterValue: string | boolean | undefined;
    if (firstFilter && firstFilter.field !== primaryField.key) {
      const filterField = productConfig.fields.find((field) => field.key === firstFilter.field)!;
      if (firstFilter.operator === "equals") editedFilterValue = filterField.options?.find((option) => option !== firstFilter.value) ?? "Different value";
      else if (firstFilter.operator === "nonEmpty") editedFilterValue = "";
      else if (firstFilter.operator === "empty") editedFilterValue = "Now filled";
      else if (firstFilter.operator === "truthy") editedFilterValue = false;
      else if (firstFilter.operator === "falsy") editedFilterValue = true;
      else editedFilterValue = "2000-01-01";
      await fillField(user, editDialog, filterField, editedFilterValue);
    }
    await user.click(within(editDialog).getByRole("button", { name: /save changes/i }));
    expect(screen.getAllByText(editedValue).length).toBeGreaterThan(0);
    const updatedStored = JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]");
    expect(updatedStored[0].values[productConfig.primaryField]).toBe(editedValue);
    if (firstFilter && editedFilterValue !== undefined) {
      expect(matchesPredicate(updatedStored[0].values[firstFilter.field], firstFilter.operator, firstFilter.value)).toBe(false);
    }
    cleanup();
    render(<App />);
    expect(screen.getAllByText(editedValue).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /delete/i }));
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
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    await user.click(screen.getAllByRole("button", { name: new RegExp(escape(action.label), "i") })[0]);
    const stored = JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]");
    const saved = stored[stored.length - 1];
    if (action.set === "today") {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      expect(String(saved.values[action.field]).startsWith(today)).toBe(true);
    } else {
      expect(saved.values[action.field]).toBe("");
    }
  });
});
