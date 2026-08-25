import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CollectionView, groupRecords } from "./CollectionView.js";
import { productConfig, type PresentationConfig } from "./product-config.js";
import type { EntityRecord } from "./repository.js";

afterEach(cleanup);

const records: EntityRecord[] = [
  { id: "one", createdAt: "2026-08-24T10:00:00Z", updatedAt: "2026-08-24T10:00:00Z", values: { title: "First", stage: "New", date: "2026-08-24" } },
  { id: "two", createdAt: "2026-08-24T11:00:00Z", updatedAt: "2026-08-24T11:00:00Z", values: { title: "Second", stage: "Done", date: "2026-08-25" } },
];

const plans: Array<[PresentationConfig, string]> = [
  [{ primary: "tracker", navigation: "single", variant: "timeline", reason: "test" }, ".tracker-view"],
  [{ primary: "table", navigation: "single", variant: "ledger", reason: "test" }, ".table-view"],
  [{ primary: "board", navigation: "single", variant: "kanban", reason: "test", groupField: "stage" }, ".board-view"],
  [{ primary: "gallery", navigation: "single", variant: "editorial", reason: "test" }, ".gallery-view"],
  [{ primary: "agenda", navigation: "single", variant: "weekly", reason: "test", dateField: "date" }, ".agenda-view"],
  [{ primary: "dashboard", navigation: "single", variant: "command", reason: "test" }, ".dashboard-view"],
  [{ primary: "standings", navigation: "sections", variant: "league", reason: "test" }, ".standings-roster"],
];

describe("structural collection views", () => {
  it.each(plans)("renders $primary as a distinct structure", (presentation, selector) => {
    const previous = productConfig.presentation;
    productConfig.presentation = presentation;
    try {
      const { container } = render(<CollectionView records={records} renderRecord={(record, view) => <article data-record-view={view}>{String(record.values.title)}</article>} />);
      expect(container.querySelector(selector)).not.toBeNull();
      expect(container.querySelectorAll("[data-record-view]")).toHaveLength(2);
    } finally {
      productConfig.presentation = previous;
    }
  });

  it("preserves record order while grouping board and agenda records", () => {
    expect(groupRecords(records, "stage", "Uncategorized").map((group) => group.label)).toEqual(["New", "Done"]);
    expect(groupRecords(records, "date", "Unscheduled").map((group) => group.label)).toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("preserves requested grouping outside board presentations", () => {
    const previous = productConfig.presentation;
    productConfig.presentation = { primary: "tracker", navigation: "single", variant: "timeline", reason: "test", groupField: "stage" };
    try {
      const { getByRole, getAllByRole } = render(<CollectionView records={records} renderRecord={(record, view) => <article data-record-view={view}>{String(record.values.title)}</article>} />);
      expect(getByRole("region", { name: new RegExp(`${productConfig.entityNamePlural} grouped by stage`, "i") })).toBeInTheDocument();
      expect(getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["New", "Done"]);
      expect(getAllByRole("list")).toHaveLength(2);
    } finally {
      productConfig.presentation = previous;
    }
  });
});
