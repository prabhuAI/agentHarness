import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { App } from "./App.js";

async function addGroup(name: string, arrivedAt: string) {
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: /add group/i })[0]!);
  const dialog = screen.getByRole("dialog");
  await user.type(dialog.querySelector<HTMLInputElement>("#field-name")!, name);
  await user.type(dialog.querySelector<HTMLInputElement>("#field-party_size")!, "2");
  await user.type(dialog.querySelector<HTMLInputElement>("#field-arrived_at")!, arrivedAt);
  await user.selectOptions(dialog.querySelector<HTMLSelectElement>("#field-status")!, "Waiting");
  await user.click(within(dialog).getByRole("button", { name: /add group/i }));
}

it("keeps the oldest waiting group first and moves the Next up badge after status changes", async () => {
  const user = userEvent.setup();
  render(<App />);
  await addGroup("Later family", "2026-08-24T18:30");
  await addGroup("First family", "2026-08-24T18:00");

  const first = screen.getByText("First family").closest("article")!;
  const later = screen.getByText("Later family").closest("article")!;
  expect(within(first).getByText("Next up")).toBeVisible();
  expect(within(later).queryByText("Next up")).toBeNull();

  await user.click(within(first).getByRole("button", { name: /edit/i }));
  const editDialog = screen.getByRole("dialog");
  await user.selectOptions(editDialog.querySelector<HTMLSelectElement>("#field-status")!, "Seated");
  await user.click(within(editDialog).getByRole("button", { name: /save changes/i }));
  expect(within(screen.getByText("Later family").closest("article")!).getByText("Next up")).toBeVisible();
});
