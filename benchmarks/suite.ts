const concepts = [
  "Track recurring household maintenance with due dates, owners, notes, and overdue counts",
  "Manage job applications through saved, applied, interview, offer, and rejected stages",
  "Catalog useful research resources with topics, links, summaries, and favorites",
  "Plan weekly meals with dates, cuisine categories, ingredients, and preparation status",
  "Monitor a small team's operating expenses with categories, amounts, dates, and totals",
  "Track plant care with species, room, last-watered date, and plants needing attention",
  "Manage equipment checkout with item, borrower, checkout date, and availability",
  "Plan a study schedule with subjects, session dates, duration, and completion status",
  "Run a lightweight bug workflow with severity, assignee, state, and open issue counts",
  "Catalog recipes with cuisine, preparation time, difficulty, and searchable instructions",
  "Track subscriptions with provider, price, renewal date, category, and monthly total",
  "Organize event tasks with owner, due date, status, notes, and remaining work count",
] as const;

const audiences = [
  "for a single person on one laptop",
  "for a family sharing one browser profile",
  "for a volunteer coordinator",
  "for a freelance designer",
  "for a student society",
  "for a neighborhood club",
  "for a small workshop",
  "for an independent consultant",
  "for a local sports coach",
  "for a community organizer",
] as const;

export const BENCHMARK_IDEAS = concepts.flatMap((concept) =>
  audiences.map((audience) => `${concept} ${audience}. Keep it simple, persistent across refreshes, and usable without login.`),
);

export const BENCHMARK_CATEGORIES = [
  "tracking", "workflow", "planning", "catalog", "dashboard", "calculation",
  "state-transition", "dates", "category", "relationship",
] as const;
