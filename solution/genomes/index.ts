import type { Genome, NormalizedProductIR } from "../ir/types.js";

export interface GenomeDefaults {
  eyebrow: string;
  collectionLabel: string;
  defaultCapabilities: string[];
}

export const GENOME_DEFAULTS: Record<Genome, GenomeDefaults> = {
  tracker: { eyebrow: "Tracker", collectionLabel: "Collection", defaultCapabilities: ["create", "edit", "delete", "search", "filter"] },
  workflow: { eyebrow: "Workflow", collectionLabel: "Pipeline", defaultCapabilities: ["create", "edit", "delete", "search", "filter", "transition"] },
  catalog: { eyebrow: "Catalog", collectionLabel: "Library", defaultCapabilities: ["create", "edit", "delete", "search", "filter", "sort"] },
  planner: { eyebrow: "Planner", collectionLabel: "Plan", defaultCapabilities: ["create", "edit", "delete", "search", "filter", "sort"] },
  dashboard: { eyebrow: "Dashboard", collectionLabel: "Data", defaultCapabilities: ["create", "edit", "delete", "filter", "calculate", "group"] },
  ledger: { eyebrow: "Ledger", collectionLabel: "Entries", defaultCapabilities: ["create", "edit", "delete", "search", "filter", "calculate"] },
  directory: { eyebrow: "Directory", collectionLabel: "Directory", defaultCapabilities: ["create", "edit", "delete", "search", "filter", "sort"] },
  log: { eyebrow: "Log", collectionLabel: "Entries", defaultCapabilities: ["create", "edit", "delete", "search", "filter", "sort"] },
  inventory: { eyebrow: "Inventory", collectionLabel: "Stock", defaultCapabilities: ["create", "edit", "delete", "search", "filter", "sort", "calculate"] },
};

export function genomeFor(ir: NormalizedProductIR): GenomeDefaults {
  return GENOME_DEFAULTS[ir.product.genome];
}
