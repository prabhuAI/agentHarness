import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { productConfig } from "./product-config.js";

beforeEach(() => { window.localStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true)); });

const requiredValue = (type: string) => type === "email" ? "person@example.com" : type === "url" ? "https://example.com" : type === "number" || type === "currency" ? "12" : type === "date" ? "2026-08-17" : type === "datetime" ? "2026-08-17T10:00" : "Sample value";

async function createRecord() {
  const user = userEvent.setup();
  const created: Record<string, string | boolean> = {};
  await user.click(screen.getAllByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") })[0]);
  const dialog = screen.getByRole("dialog");
  for (const field of productConfig.fields.filter((candidate) => candidate.required || candidate.key === productConfig.primaryField)) {
    if (field.type === "boolean") { await user.click(within(dialog).getByLabelText(new RegExp(field.label, "i"))); created[field.key] = true; }
    else {
      const control = within(dialog).getByLabelText(new RegExp(field.label, "i"));
      const value = field.options && !field.allowCustom ? field.options[0] : requiredValue(field.type);
      if (field.options && !field.allowCustom) await user.selectOptions(control, value);
      else await user.type(control, value);
      created[field.key] = value;
    }
  }
  await user.click(within(dialog).getByRole("button", { name: new RegExp(`add ${productConfig.entityName}`, "i") }));
  return created;
}

describe("compiled product runtime", () => {
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
    expect(window.localStorage.length).toBe(1);
    for (const summary of productConfig.summaries) expect(screen.getAllByText(summary.label).length).toBeGreaterThan(0);
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
