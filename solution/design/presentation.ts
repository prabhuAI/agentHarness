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
 * Resolve one authoritative presentation from product meaning. The model still
 * supplies a broad genome, but obvious structural evidence (standings, status
 * stages, dated events, charts, dense records) wins when that genome is too
 * generic. This prevents a tracker layout and dashboard view being selected by
 * two independent runtime systems.
 */
export function resolvePresentation(ir: NormalizedProductIR): PresentationPlan {
  const entity = ir.entities[0];
  const navigation: NavigationMode = ir.entities.length > 1 ? "sections" : "single";
  const seed = `${ir.product.name}\0${ir.product.targetUser}`;
  const text = `${ir.product.name} ${ir.product.description} ${ir.product.tagline}`.toLowerCase();
  const status = entity.fields.find((field) => field.type === "status" && (field.options?.length ?? 0) >= 2 && !field.derive);
  const groupField = entity.fields.find((field) => !field.derive && (field.type === "category" || field.type === "status"));
  const date = entity.fields.find((field) => field.type === "date" || field.type === "datetime");
  const eventLanguage = /\b(agenda|appointment|calendar|class|event|meeting|reservation|schedule|session|shift|timetable|upcoming activit(?:y|ies))\b/u.test(text);

  let primary: PrimaryView;
  let reason: string;
  if (ir.standings.length > 0) {
    primary = "standings";
    reason = "scored participant aggregation";
  } else if (status && ir.product.genome === "workflow") {
    primary = "board";
    reason = `workflow grouped by ${status.id}`;
  } else if (ir.product.genome === "planner" || (date && eventLanguage)) {
    primary = "agenda";
    reason = date ? `date-centered planning by ${date.id}` : "planning workspace";
  } else if (ir.product.genome === "catalog") {
    primary = "gallery";
    reason = "catalog browsing";
  } else if (ir.product.genome === "dashboard" || ir.charts.length > 0 || ir.calculations.length >= 4) {
    primary = "dashboard";
    reason = "metrics-led monitoring";
  } else if (groupField && ir.capabilities.group) {
    primary = "board";
    reason = `records grouped by ${groupField.id}`;
  } else if (entity.fields.length >= 7 || navigation === "sections") {
    primary = "table";
    reason = "dense or relational records";
  } else {
    primary = "tracker";
    reason = "focused record tracking";
  }

  return {
    primary,
    navigation,
    variant: variantFor(primary, seed),
    reason,
    ...(ir.capabilities.group && groupField ? { groupField: groupField.id } : {}),
    ...(primary === "agenda" && date ? { dateField: date.id } : {}),
  };
}
