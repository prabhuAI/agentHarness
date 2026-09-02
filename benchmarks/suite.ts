export interface BenchmarkCase {
  id: string;
  category: string;
  idea: string;
}

// The first 20 cases are deliberately hand-written rather than generated from a
// single template. `npm run benchmark -- --limit 20` therefore exercises varied
// language, ambiguity, relationships, calculations, queues, and custom routing.
export const BENCHMARK_CORE_CASES: BenchmarkCase[] = [
  { id: "maintenance-overdue", category: "dates", idea: "Our flat has filters, smoke alarms and other chores that repeat at different intervals. I forget the last time each was done. Show what is overdue or coming up, let me tap Done, and keep notes. Just for this laptop." },
  { id: "job-application-pipeline", category: "workflow", idea: "I need a tiny job hunt board: company, role, link, salary range, next follow-up and stage. I say 'saved', 'applied', 'interview', 'offer' or 'nope'. I want to move things along and filter by stage." },
  { id: "research-library", category: "catalog", idea: "Make me a personal research stash for papers and useful links. Save a title, URL, topic, a proper summary and whether it is a favourite. Search should find words in the notes too; topic suggestions should not prevent my own topics." },
  { id: "meal-planner", category: "planning", idea: "Plan dinners for the week with date, dish, cuisine, ingredients and prep status. I mostly need to see today's meal and the coming week, and correct plans when they change." },
  { id: "expense-dashboard", category: "calculation", idea: "A freelancer expense log with merchant, amount, date, category and receipt link. Show this month's spending, totals by category and a simple spending-over-time chart. Everything stays in my browser." },
  { id: "plant-care", category: "derived-state", idea: "My plants have different watering frequencies. Record plant, room, days between watering, last watered and notes. Work out overdue / due soon / fine automatically and give me a Watered today button." },
  { id: "equipment-checkout", category: "state-transition", idea: "We lend workshop gear. Keep item name, serial number, category and who has it. If the borrower is filled in it is checked out; clearing their name means returned. I need an out-now filter and count." },
  { id: "study-sessions", category: "planning", idea: "I want a study diary with subject, session date, minutes, confidence score and notes. Let me see total minutes, average confidence, search notes and view confidence over time." },
  { id: "bug-triage", category: "workflow", idea: "Give our volunteer team a no-login bug queue: short title, full reproduction notes, severity, owner, state and reported date. Sort urgent things first and show open counts by severity." },
  { id: "recipe-box", category: "catalog", idea: "Build a recipe box. A recipe needs a name, cuisine-ish category, prep minutes, difficulty, ingredients and method. 'Cuisine-ish' means offer common choices but let me type another. Search ingredients and instructions." },
  { id: "subscription-cost", category: "formula", idea: "Track subscriptions with provider, price, billing frequency, renewal date and category. I want each subscription's monthly equivalent, the total monthly cost and which renew this month." },
  { id: "event-priority", category: "priority", idea: "At our community event people join a help desk queue. Save their name, arrival time, request and status. Always highlight who is next: the oldest person still Waiting. Editing Served should move the marker." },
  { id: "league-standings", category: "relationship", idea: "Run a five-a-side league. Manage teams separately, enter matches with home team, away team and both scores, then calculate a 3/1/0 standings table with played, wins, draws, losses, goal difference and points." },
  { id: "project-task-relations", category: "relationship", idea: "I juggle several client projects and their tasks. Projects need a name and client; tasks belong to a project and have title, due date, owner and status. I must manage both lists and filter unfinished tasks." },
  { id: "inventory-low-stock", category: "calculation", idea: "A small craft shop inventory: item, SKU, category, units on hand, reorder level and unit price. Show remaining-versus-reorder as a derived number, let me add or subtract stock quickly, and filter low items." },
  { id: "decision-log-conditional", category: "conditional-fields", idea: "Keep a team decision log with question, date, owner and status. When status is Accepted I need a rationale field; otherwise that field is irrelevant. Search old decisions and show counts by status." },
  { id: "contact-directory", category: "validation", idea: "A private partner directory with organisation, contact name, email, website, relationship type and notes. Validate email and links, allow custom relationship types and make every text field searchable." },
  { id: "invoice-tracker", category: "workflow", idea: "Track freelance invoices: client, invoice number, amount, issued date, due date and unpaid/paid status. I want overdue and due-this-month views, total unpaid value, and a one-click Mark paid action." },
  { id: "dependency-roadmap", category: "custom", idea: "Plan product initiatives with title, owner, quarter and state, but the heart of it is an interactive dependency graph where I draw arrows between initiatives and rearrange nodes." },
  { id: "audio-practice", category: "custom", idea: "I am practising pronunciation. Save phrases and difficulty, record audio in the browser, play attempts back, and draw a waveform for every recording. Keep it local and simple." },
];

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

const GENERATED_BENCHMARK_IDEAS = concepts.flatMap((concept) =>
  audiences.map((audience) => `${concept} ${audience}. Keep it simple, persistent across refreshes, and usable without login.`),
);

export const BENCHMARK_CASES: BenchmarkCase[] = [
  ...BENCHMARK_CORE_CASES,
  ...GENERATED_BENCHMARK_IDEAS.map((idea, index) => ({ id: `generated-${index + 1}`, category: "generated", idea })),
];

export const BENCHMARK_IDEAS = BENCHMARK_CASES.map((entry) => entry.idea);

export const BENCHMARK_CATEGORIES = [
  "tracking", "workflow", "planning", "catalog", "dashboard", "calculation",
  "state-transition", "dates", "category", "relationship",
] as const;
