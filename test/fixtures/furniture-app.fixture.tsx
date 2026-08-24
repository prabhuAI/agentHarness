import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { App } from "./App.js";

const money = (value: number) => new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(value);

it("shows Building work and updates the unpaid balance from persisted order values", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getAllByRole("button", { name: /add order/i })[0]!);
  const createDialog = screen.getByRole("dialog");
  await user.type(createDialog.querySelector<HTMLInputElement>("#field-piece")!, "Oak table");
  await user.selectOptions(createDialog.querySelector<HTMLSelectElement>("#field-status")!, "Building");
  await user.type(createDialog.querySelector<HTMLInputElement>("#field-price")!, "1000");
  await user.type(createDialog.querySelector<HTMLInputElement>("#field-deposit")!, "250");
  await user.click(within(createDialog).getByRole("button", { name: /add order/i }));

  expect(screen.getAllByText("Oak table").length).toBeGreaterThan(0);
  expect(screen.getAllByText(money(750)).length).toBeGreaterThan(0);
  const summary = screen.getByLabelText("Summary");
  expect(summary.querySelector('[data-summary-id="unpaid_balance"] strong')).toHaveTextContent(money(750));

  const filters = within(screen.getByRole("group", { name: /filter orders/i }));
  await user.click(filters.getByRole("button", { name: /^building$/i }));
  expect(screen.getAllByText("Oak table").length).toBeGreaterThan(0);
  await user.click(filters.getByRole("button", { name: /^unpaid$/i }));
  expect(screen.getAllByText("Oak table").length).toBeGreaterThan(0);

  await user.click(screen.getByRole("button", { name: /edit/i }));
  const editDialog = screen.getByRole("dialog");
  await user.click(editDialog.querySelector<HTMLInputElement>("#field-paid")!);
  await user.click(within(editDialog).getByRole("button", { name: /save changes/i }));
  expect(summary.querySelector('[data-summary-id="unpaid_balance"] strong')).toHaveTextContent(money(0));
});
