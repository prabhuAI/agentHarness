import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { productConfig } from "./product-config.js";
import { createRepository, storageKeyFor } from "./repository.js";

beforeEach(() => { window.localStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true)); });
afterEach(cleanup);

const requiredValue = (type: string) => type === "email" ? "person@example.com" : type === "url" ? "https://example.com" : type === "number" || type === "currency" ? "12" : type === "date" ? "2026-08-17" : type === "datetime" ? "2026-08-17T10:00" : "Sample value";

async function createRecord() {
  const user = userEvent.setup();
  const created: Record<string, string | boolean> = {};
  await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
  const dialog = screen.getByRole("dialog");
  for (const field of productConfig.fields.filter((candidate) => candidate.required || candidate.key === productConfig.primaryField)) {
    // Query by the runtime's deterministic control id: label-based regex queries
    // throw when one product label is a substring of another.
    const control = dialog.querySelector<HTMLElement>(`#field-${field.key}`);
    if (!control) continue;
    if (field.type === "boolean") { await user.click(control); created[field.key] = true; }
    else {
      const value = field.options?.[0] ?? requiredValue(field.type);
      if (field.options?.length) await user.selectOptions(control, value);
      else await user.type(control, value);
      created[field.key] = value;
    }
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
    expect(app).toHaveStyle(`--accent: ${productConfig.design.colors.accent}`);
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main");
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
    expect(configurable).toBeDefined();
    render(<App />);
    await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
    const choice = screen.getByRole("dialog").querySelector<HTMLElement>(`#field-${configurable!.key}`)!;
    expect(choice).toBeInTheDocument();
    for (const option of configurable!.options!) expect(within(choice).getByRole("option", { name: option })).toBeInTheDocument();
    await user.selectOptions(choice, within(choice).getByRole("option", { name: "Other…" }));
    const custom = within(screen.getByRole("dialog")).getByRole("textbox", { name: `Custom ${configurable!.label}` });
    await user.type(custom, "Custom choice");
    expect(custom).toHaveValue("Custom choice");
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

    const created = await createRecord();
    const primaryValue = String(created[productConfig.primaryField]);
    expect(screen.getAllByText(primaryValue).length).toBeGreaterThan(0);
    expect(JSON.parse(window.localStorage.getItem(storageKeyFor(productConfig.name)) ?? "[]")).toHaveLength(1);
    const groupField = productConfig.fields.find((field) => field.type === "category" || field.type === "status");
    if (productConfig.capabilities.group && groupField) {
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
      await user.selectOptions(screen.getByRole("combobox", { name: new RegExp(`filter ${productConfig.entityNamePlural}`, "i") }), preset.id);
      const text = String(created[preset.field] ?? "").trim();
      const matches = preset.operator === "equals" ? text === String(preset.value ?? "")
        : preset.operator === "nonEmpty" ? text !== ""
        : preset.operator === "empty" ? text === ""
        : preset.operator === "truthy" ? created[preset.field] === true
        : created[preset.field] !== true;
      if (matches) expect(screen.getAllByText(primaryValue).length).toBeGreaterThan(0);
      else expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
      await user.selectOptions(screen.getByRole("combobox", { name: new RegExp(`filter ${productConfig.entityNamePlural}`, "i") }), "all");
    }
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /close/i }));
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByText(new RegExp(`no ${productConfig.entityNamePlural}`, "i"))).toBeInTheDocument();
  });
});
