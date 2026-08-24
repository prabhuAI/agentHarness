import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { App } from "./App.js";

async function addTeam(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getAllByRole("button", { name: /add team/i })[0]!);
  const dialog = screen.getByRole("dialog");
  await user.type(dialog.querySelector<HTMLInputElement>("#field-name")!, name);
  await user.click(within(dialog).getByRole("button", { name: /add team/i }));
}

async function addMatch(user: ReturnType<typeof userEvent.setup>, home: string, away: string, homeGoals: string, awayGoals: string) {
  await user.click(screen.getByRole("button", { name: /add match/i }));
  const dialog = screen.getByRole("dialog");
  const homeSelect = dialog.querySelector<HTMLSelectElement>("#related-match-home_team")!;
  const awaySelect = dialog.querySelector<HTMLSelectElement>("#related-match-away_team")!;
  const optionValue = (select: HTMLSelectElement, label: string) => [...select.options].find((option) => option.text === label)!.value;
  await user.selectOptions(homeSelect, optionValue(homeSelect, home));
  await user.selectOptions(awaySelect, optionValue(awaySelect, away));
  await user.type(dialog.querySelector<HTMLInputElement>("#related-match-home_goals")!, homeGoals);
  await user.type(dialog.querySelector<HTMLInputElement>("#related-match-away_goals")!, awayGoals);
  await user.click(within(dialog).getByRole("button", { name: /add match/i }));
}

it("enters teams and results, ranks them, and persists the computed table", async () => {
  const user = userEvent.setup();
  const view = render(<App />);
  await addTeam(user, "Riverside Rovers");
  await addTeam(user, "Park United");
  await addMatch(user, "Riverside Rovers", "Park United", "2", "1");
  await addMatch(user, "Park United", "Riverside Rovers", "1", "1");
  expect(screen.getByRole("heading", { name: "Riverside Rovers vs Park United" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Park United vs Riverside Rovers" })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/iu);

  const table = screen.getByRole("table");
  const riverside = within(table).getByRole("row", { name: /Riverside Rovers/ });
  const park = within(table).getByRole("row", { name: /Park United/ });
  expect(riverside).toHaveTextContent("2");
  expect(riverside).toHaveTextContent("1");
  expect(within(riverside).getAllByRole("cell").at(-1)).toHaveTextContent("4");
  expect(within(park).getAllByRole("cell").at(-1)).toHaveTextContent("1");

  view.unmount();
  render(<App />);
  const rehydrated = screen.getByRole("table");
  expect(within(rehydrated).getByRole("row", { name: /Riverside Rovers/ })).toBeInTheDocument();
  expect(within(rehydrated).getByRole("row", { name: /Park United/ })).toBeInTheDocument();
});
