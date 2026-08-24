import type { ProductConfig } from "./product-config.js";

export type PrimaryView = "cards" | "table" | "board" | "gallery" | "agenda" | "dashboard" | "standings";
export type NavigationMode = "single" | "sections";

export interface ViewPlan {
  primary: PrimaryView;
  navigation: NavigationMode;
  reason: string;
}

/**
 * Selects information architecture from semantics the model already emitted.
 * This deliberately adds nothing to Product IR or the model prompt: layout
 * diversity is a deterministic expansion of fields, capabilities, and views.
 */
export function resolveViewPlan(config: ProductConfig): ViewPlan {
  const navigation: NavigationMode = (config.entities?.length ?? 0) > 1 ? "sections" : "single";
  const status = config.fields.find((field) => field.type === "status" && (field.options?.length ?? 0) >= 2);
  const hasDate = config.fields.some((field) => field.type === "date" || field.type === "datetime");

  if ((config.standings?.length ?? 0) > 0) return { primary: "standings", navigation, reason: "scored participant aggregation" };
  if (status && config.capabilities.group) return { primary: "board", navigation, reason: `workflow grouped by ${status.key}` };
  if (config.genome === "planner" && hasDate) return { primary: "agenda", navigation, reason: "date-centered planning" };
  if (config.genome === "catalog") return { primary: "gallery", navigation, reason: "catalog browsing" };
  if (config.genome === "dashboard" || config.charts.length > 0 || config.summaries.length >= 4) {
    return { primary: "dashboard", navigation, reason: "metrics-led monitoring" };
  }
  if (config.fields.length >= 7 || navigation === "sections") return { primary: "table", navigation, reason: "dense or relational records" };
  return { primary: "cards", navigation, reason: "compact record collection" };
}
