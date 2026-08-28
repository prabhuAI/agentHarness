import type { NormalizedProductIR } from "../ir/types.js";

export type PrimaryView = "tracker" | "table" | "board" | "gallery" | "agenda" | "dashboard" | "standings";
export type NavigationMode = "single" | "sections";

export interface PresentationPlan {
  primary: PrimaryView;
  navigation: NavigationMode;
  variant: string;
  reason: string;
  groupField?: string;
  dateField?: string;
}

const VARIANTS: Record<PrimaryView, readonly string[]> = {
  tracker: ["timeline", "checklist", "milestones"],
  table: ["ledger", "directory", "dense"],
  board: ["kanban", "pipeline", "swimlanes"],
  gallery: ["editorial", "storefront", "directory"],
  agenda: ["weekly", "timeline", "calendar"],
  dashboard: ["command", "scorecard", "analyst"],
  standings: ["league", "scoreboard", "compact"],
};

function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function variantFor(primary: PrimaryView, seed: string): string {
  const variants = VARIANTS[primary];
  return variants[seedFrom(`${primary}\0${seed}`) % variants.length]!;
}

/**
 * Resolve one authoritative presentation from what the product IR says the user
 * actually needs to do — not from incidental signals (the model's genome guess,
 * or how many count metrics it happened to emit).
 *
 * A plain table is the honest default for a single-entity register you scan,
 * search, filter and edit. The specialised layouts are only "really correct"
 * when the IR carries a *strong* signal for them, so they must each earn their
 * place:
 *   - standings  → the IR defines a scored standings table.
 *   - dashboard  → real charts, or an explicit dashboard-genome product.
 *                  (Incidental group counts render as a stat strip above the
 *                  table; they do not turn a list into a dashboard.)
 *   - board      → a genuine lifecycle: an author-set status with ≥2 stages AND
 *                  the transition capability that moves records between them.
 *                  (Grouping by a mere category is a filter, not a board.)
 *   - agenda     → a date axis the record is built around, plus planning intent.
 *   - gallery    → real media to show. The field vocabulary has no image type,
 *                  so this requires a url field named like cover art; a catalog
 *                  with no images is a table, not empty placeholder tiles.
 *   - tracker    → progress/checklist semantics: a completion boolean, a "mark
 *                  done today" quick action, or an ordered priority queue.
 *   - table      → everything else (the default).
 */
export function resolvePresentation(ir: NormalizedProductIR): PresentationPlan {
  const entity = ir.entities[0];
  const navigation: NavigationMode = ir.entities.length > 1 ? "sections" : "single";
  const seed = `${ir.product.name}\0${ir.product.targetUser}`;
  const text = `${ir.product.name} ${ir.product.description} ${ir.product.tagline}`.toLowerCase();

  // A genuine lifecycle field: author-set (not derived) with real stages.
  const statusField = entity.fields.find((field) => field.type === "status" && (field.options?.length ?? 0) >= 2 && !field.derive);
  // A category/status usable for grouping into sections or filter chips.
  const groupField = entity.fields.find((field) => !field.derive && (field.type === "category" || field.type === "status"));
  const dateField = entity.fields.find((field) => field.type === "date" || field.type === "datetime");
  const eventLanguage = /\b(agenda|appointment|calendar|class|event|meeting|reservation|schedule|session|shift|timetable|upcoming activit(?:y|ies))\b/u.test(text);
  // Gallery needs media to show. There is no image field type, so only a url
  // field named like cover art counts as something to display.
  const imageField = entity.fields.find((field) => field.type === "url" && /\b(image|images|photo|photos|picture|pictures|cover|thumbnail|thumb|poster|artwork|banner|avatar)\b/u.test(`${field.id} ${field.label}`.toLowerCase()));
  // Tracker/checklist evidence: a completion flag, a "mark done today" action, or
  // an ordered queue.
  const completion = entity.fields.some((field) => field.type === "boolean")
    || ir.quickActions.some((action) => action.set === "today")
    || Boolean(ir.priority);

  let primary: PrimaryView;
  let reason: string;
  if (ir.standings.length > 0) {
    primary = "standings";
    reason = "scored participant aggregation";
  } else if (ir.charts.length > 0 || ir.product.genome === "dashboard") {
    primary = "dashboard";
    reason = ir.charts.length > 0 ? "chart-led monitoring" : "metrics dashboard product";
  } else if (ir.product.genome === "planner" || (dateField && eventLanguage) || (ir.product.genome === "log" && dateField)) {
    // Planning is time-anchored; it outranks a status board even when a status
    // field is present. A log is a dated event stream, so it reads as an agenda
    // too — but only when it actually has a date axis to order by.
    primary = "agenda";
    reason = ir.product.genome === "log" ? `chronological log by ${dateField!.id}` : dateField ? `date-centered planning by ${dateField.id}` : "planning workspace";
  } else if (statusField && (ir.capabilities.transition || ir.product.genome === "workflow")) {
    primary = "board";
    reason = `lifecycle grouped by ${statusField.id}`;
  } else if (imageField && ir.product.genome === "catalog") {
    primary = "gallery";
    reason = "media catalog browsing";
  } else if (ir.product.genome === "tracker" && completion) {
    primary = "tracker";
    reason = "progress / checklist tracking";
  } else {
    primary = "table";
    reason = "single-entity register";
  }

  const groupId = primary === "board" && statusField ? statusField.id
    // Agenda already groups by its date axis; adding a category wrapper on top
    // just nests and squeezes the day columns. Only fall back to a category
    // grouping when there is no date to group by.
    : primary === "agenda" ? (dateField ? undefined : (ir.capabilities.group && groupField ? groupField.id : undefined))
    : primary !== "table" && ir.capabilities.group && groupField ? groupField.id
    : undefined;
  return {
    primary,
    navigation,
    variant: variantFor(primary, seed),
    reason,
    ...(groupId ? { groupField: groupId } : {}),
    ...(primary === "agenda" && dateField ? { dateField: dateField.id } : {}),
  };
}
