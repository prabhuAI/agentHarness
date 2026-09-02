import type { NormalizedProductIR, RouteDecision } from "../ir/types.js";

const RUNTIME_CAPABILITIES = new Set(["create", "edit", "delete", "search", "filter", "sort", "group", "calculate", "transition", "export"]);

/**
 * The interpretation model occasionally repeats a built-in runtime behavior in
 * customRequirements. Treat only narrow, demonstrably implemented descriptions
 * as supported; novel interaction language must continue to select hybrid/custom.
 */
function isBuiltInRequirement(requirement: string): boolean {
  const text = requirement.toLowerCase();
  const fieldValidation = (text.includes("email") || text.includes("url") || text.includes("website"))
    && (text.includes("validat") || text.includes("format") || text.includes("malformed") || text.includes("invalid"));
  const broadTextSearch = text.includes("search")
    && (text.includes("text field") || text.includes("searchable field") || text.includes("match across"));
  return fieldValidation || broadTextSearch;
}

export function classifyCapabilities(ir: NormalizedProductIR): RouteDecision {
  const requested = Object.entries(ir.capabilities).filter(([, enabled]) => enabled).map(([name]) => name);
  const unsupported = requested.filter((name) => !RUNTIME_CAPABILITIES.has(name));
  const repeatedBuiltIns = ir.customRequirements.filter(isBuiltInRequirement);
  unsupported.push(...ir.customRequirements.filter((requirement) => !isBuiltInRequirement(requirement)));
  const supported = requested.filter((name) => RUNTIME_CAPABILITIES.has(name));
  // Trend charts are a deterministic runtime feature, not a custom requirement,
  // so they count as supported and never push the idea off the compile route.
  if (ir.charts.length > 0) supported.push("chart");
  supported.push(...repeatedBuiltIns);
  if (unsupported.length === 0) return {
    route: "compile", genome: ir.product.genome, supported, unsupported: [],
    reason: "Every required behavior maps to the deterministic runtime.",
  };
  const coreIsNovel = unsupported.length > 2;
  return {
    route: coreIsNovel ? "custom" : "hybrid",
    genome: ir.product.genome,
    supported,
    unsupported: [...new Set(unsupported)],
    reason: coreIsNovel
      ? "The core interaction needs focused custom code."
      : "The runtime covers the product shell; only listed requirements need custom code.",
  };
}
