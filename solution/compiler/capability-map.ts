import type { NormalizedProductIR, RouteDecision } from "../ir/types.js";

const RUNTIME_CAPABILITIES = new Set(["create", "edit", "delete", "search", "filter", "sort", "group", "calculate", "transition"]);

export function classifyCapabilities(ir: NormalizedProductIR): RouteDecision {
  const requested = Object.entries(ir.capabilities).filter(([, enabled]) => enabled).map(([name]) => name);
  const unsupported = requested.filter((name) => !RUNTIME_CAPABILITIES.has(name));
  if (ir.entities.length > 1) unsupported.push("multiple editable entities");
  unsupported.push(...ir.customRequirements);
  const supported = requested.filter((name) => RUNTIME_CAPABILITIES.has(name));
  if (unsupported.length === 0) return {
    route: "compile", genome: ir.product.genome, supported, unsupported: [],
    reason: "Every required behavior maps to the deterministic runtime.",
  };
  const coreIsNovel = ir.customRequirements.length > 2 || (ir.entities.length > 1 && supported.length < 2);
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
