import { writeFile } from "node:fs/promises";
import path from "node:path";
import { genomeFor } from "../genomes/index.js";
import type { NormalizedProductIR, ProductCalculation, ProductFilter, RouteDecision } from "../ir/types.js";
import type { DerivedJourney } from "../qa/derive-journeys.js";

interface CompiledConfig {
  name: string;
  tagline: string;
  entityName: string;
  entityNamePlural: string;
  genome: string;
  eyebrow: string;
  collectionLabel: string;
  accent: string;
  primaryField: string;
  secondaryFields: string[];
  searchableFields: string[];
  filters: Array<ProductFilter & { field: string }>;
  summaries: ProductCalculation[];
  capabilities: { create: boolean; edit: boolean; delete: boolean; search: boolean; sort: boolean; group: boolean };
  fields: Array<Record<string, unknown>>;
}

export function compileConfig(ir: NormalizedProductIR): CompiledConfig {
  const entity = ir.entities[0];
  const genome = genomeFor(ir);
  const searchableFields = entity.fields.filter((field) => ["text", "longText", "category", "status", "email", "url"].includes(field.type)).map((field) => field.id);
  const hasGroupableField = entity.fields.some((field) => field.type === "category" || field.type === "status");
  const secondaryFields = entity.fields.filter((field) => field.id !== entity.primaryField).slice(0, 4).map((field) => field.id);
  const summaries = ir.calculations.length > 0 ? ir.calculations : [{ id: "total", label: `Total ${entity.plural}`, operation: "count" as const }];
  return {
    name: ir.product.name,
    tagline: ir.product.tagline,
    entityName: entity.name,
    entityNamePlural: entity.plural,
    genome: ir.product.genome,
    eyebrow: genome.eyebrow,
    collectionLabel: genome.collectionLabel,
    accent: ir.product.accent ?? "#5b5bd6",
    primaryField: entity.primaryField,
    secondaryFields,
    searchableFields,
    filters: ir.filters,
    summaries,
    capabilities: {
      create: ir.capabilities.create,
      edit: ir.capabilities.edit,
      delete: ir.capabilities.delete,
      search: ir.capabilities.search && searchableFields.length > 0,
      sort: ir.capabilities.sort,
      group: ir.capabilities.group && hasGroupableField,
    },
    fields: entity.fields.map((field) => ({
      key: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.options ? { options: field.options } : {}),
      ...(field.allowCustom !== undefined ? { allowCustom: field.allowCustom } : {}),
      ...(field.min !== undefined ? { min: field.min } : {}),
      ...(field.max !== undefined ? { max: field.max } : {}),
    })),
  };
}

export async function writeCompiledProduct(
  appRoot: string,
  ir: NormalizedProductIR,
  route: RouteDecision,
  journeys: DerivedJourney[],
): Promise<void> {
  const config = compileConfig(ir);
  const ideaSpec = {
    target_user: ir.product.targetUser,
    core_utility: ir.product.description,
    included_features: route.supported,
    excluded_features: ir.excluded,
    assumptions: ir.assumptions,
  };
  const summary = [
    `# ${ir.product.name}`,
    "",
    ir.product.description,
    "",
    `- **Target user:** ${ir.product.targetUser}`,
    `- **Build route:** ${route.route}`,
    `- **Genome:** ${route.genome}`,
    `- **Persistence:** browser-local storage`,
    `- **Start:** \`npm run dev\` → http://localhost:3000`,
    "",
    "## Verified journeys",
    "",
    ...journeys.map((journey) => `- ${journey.description}`),
    "",
  ].join("\n");
  await Promise.all([
    writeFile(path.join(appRoot, "product.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8"),
    writeFile(path.join(appRoot, "product-ir.json"), `${JSON.stringify(ir, null, 2)}\n`, "utf8"),
    writeFile(path.join(appRoot, "idea_spec.json"), `${JSON.stringify(ideaSpec, null, 2)}\n`, "utf8"),
    writeFile(path.join(appRoot, "summary.md"), summary, "utf8"),
    writeFile(path.join(appRoot, ".compiler-state.json"), `${JSON.stringify({ route, journeys }, null, 2)}\n`, "utf8"),
  ]);
}
