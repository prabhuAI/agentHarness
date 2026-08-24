import { writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDesign, type CompiledDesign } from "../design/catalog.js";
import { genomeFor } from "../genomes/index.js";
import type { NormalizedProductIR, ProductCalculation, ProductChart, ProductEntity, ProductFilter, ProductPriority, ProductQuickAction, ProductStandings, RouteDecision } from "../ir/types.js";
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
  design: CompiledDesign;
  primaryField: string;
  secondaryFields: string[];
  searchableFields: string[];
  filters: Array<ProductFilter & { field: string }>;
  summaries: ProductCalculation[];
  charts: ProductChart[];
  quickActions: ProductQuickAction[];
  sorts: Array<{ id: string; label: string; field?: string; direction?: "asc" | "desc"; type?: string }>;
  capabilities: { create: boolean; edit: boolean; delete: boolean; search: boolean; sort: boolean; group: boolean };
  fields: Array<Record<string, unknown>>;
  entities?: CompiledEntityConfig[];
  standings?: ProductStandings[];
  priority?: ProductPriority;
}

interface CompiledEntityConfig {
  name: string;
  plural: string;
  primaryField: string;
  secondaryFields: string[];
  searchableFields: string[];
  fields: Array<Record<string, unknown>>;
}

function compileFields(entity: ProductEntity): Array<Record<string, unknown>> {
  return entity.fields.map((field) => ({
    key: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.options ? { options: field.options } : {}),
    ...(field.allowCustom !== undefined ? { allowCustom: field.allowCustom } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.visibleWhen ? { visibleWhen: field.visibleWhen } : {}),
    ...(field.derive ? { derive: field.derive } : {}),
  }));
}

function compileEntity(entity: ProductEntity): CompiledEntityConfig {
  return {
    name: entity.name,
    plural: entity.plural,
    primaryField: entity.primaryField,
    secondaryFields: entity.fields.filter((field) => field.id !== entity.primaryField).slice(0, 4).map((field) => field.id),
    searchableFields: entity.fields.filter((field) => ["text", "longText", "category", "status", "email", "url"].includes(field.type)).map((field) => field.id),
    fields: compileFields(entity),
  };
}

// Sort options offered by the list control: the two built-in time orderings
// plus one option per meaningful field — the primary label (A→Z), a date
// (newest first), and a measure (highest first) — so a spend tracker can sort by
// amount or date, not just by name. Derived from the fields, never model-authored.
function compileSorts(entity: NormalizedProductIR["entities"][number], priority?: ProductPriority): CompiledConfig["sorts"] {
  const sorts: CompiledConfig["sorts"] = [
    ...(priority ? [{
      id: "priority",
      label: priority.label,
      field: priority.sortField,
      direction: priority.direction,
      type: entity.fields.find((field) => field.id === priority.sortField)!.type,
    }] : []),
    { id: "updated", label: "Recently updated" },
    { id: "created", label: "Oldest first" },
  ];
  const add = (field: { id: string; label: string; type: string } | undefined, direction: "asc" | "desc") => {
    if (!field || sorts.some((sort) => sort.field === field.id)) return;
    sorts.push({ id: `by_${field.id}`, label: `By ${field.label.toLowerCase()}`, field: field.id, direction, type: field.type });
  };
  const primary = entity.fields.find((field) => field.id === entity.primaryField);
  if (primary && ["text", "longText", "email", "url", "category", "status"].includes(primary.type)) add(primary, "asc");
  add(entity.fields.find((field) => field.type === "date" || field.type === "datetime"), "desc");
  add(entity.fields.find((field) => field.type === "currency") ?? entity.fields.find((field) => field.type === "number"), "desc");
  return sorts;
}

export function compileConfig(ir: NormalizedProductIR): CompiledConfig {
  const entity = ir.entities[0];
  const genome = genomeFor(ir);
  const searchableFields = entity.fields.filter((field) => ["text", "longText", "category", "status", "email", "url"].includes(field.type)).map((field) => field.id);
  const hasGroupableField = entity.fields.some((field) => field.type === "category" || field.type === "status");
  const secondaryFields = entity.fields.filter((field) => field.id !== entity.primaryField).slice(0, 4).map((field) => field.id);
  const primaryCalculations = ir.calculations.filter((calculation) => !calculation.entity || calculation.entity === entity.name);
  const summaries = primaryCalculations.length > 0 ? primaryCalculations : [{ id: "total", label: `Total ${entity.plural}`, operation: "count" as const }];
  // Seed on name + target user so even same-concept products for different audiences
  // resolve to distinct looks, while identical products stay identical.
  const design = resolveDesign(ir.product.genome, ir.product.design, `${ir.product.name}\0${ir.product.targetUser}`);
  return {
    name: ir.product.name,
    tagline: ir.product.tagline,
    entityName: entity.name,
    entityNamePlural: entity.plural,
    genome: ir.product.genome,
    eyebrow: genome.eyebrow,
    collectionLabel: genome.collectionLabel,
    accent: design.colors.accent,
    design,
    primaryField: entity.primaryField,
    secondaryFields,
    searchableFields,
    filters: ir.filters,
    summaries,
    charts: ir.charts,
    quickActions: ir.quickActions,
    sorts: compileSorts(entity, ir.priority),
    capabilities: {
      create: ir.capabilities.create,
      edit: ir.capabilities.edit,
      delete: ir.capabilities.delete,
      search: ir.capabilities.search && searchableFields.length > 0,
      sort: ir.capabilities.sort,
      group: ir.capabilities.group && hasGroupableField,
    },
    fields: compileFields(entity),
    ...(ir.entities.length > 1 ? { entities: ir.entities.map(compileEntity) } : {}),
    ...(ir.standings.length > 0 ? { standings: ir.standings } : {}),
    ...(ir.priority ? { priority: ir.priority } : {}),
  };
}

export async function writeCompiledProduct(
  appRoot: string,
  ir: NormalizedProductIR,
  route: RouteDecision,
  journeys: DerivedJourney[],
): Promise<void> {
  const config = compileConfig(ir);
  // Keep legacy single-entity Product IR artifacts byte-stable. The normalized
  // empty array is an internal convenience and carries no product meaning.
  const { standings, ...legacyIr } = ir;
  const serializedIr = standings.length > 0 ? ir : legacyIr;
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
    "## Planned verification journeys",
    "",
    ...journeys.map((journey) => `- ${journey.description}`),
    "",
  ].join("\n");
  await Promise.all([
    writeFile(path.join(appRoot, "product.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8"),
    writeFile(path.join(appRoot, "product-ir.json"), `${JSON.stringify(serializedIr, null, 2)}\n`, "utf8"),
    writeFile(path.join(appRoot, "idea_spec.json"), `${JSON.stringify(ideaSpec, null, 2)}\n`, "utf8"),
    writeFile(path.join(appRoot, "summary.md"), summary, "utf8"),
    writeFile(path.join(appRoot, ".compiler-state.json"), `${JSON.stringify({ route, journeys }, null, 2)}\n`, "utf8"),
  ]);
}

export async function writeJourneySummary(
  appRoot: string,
  ir: NormalizedProductIR,
  route: RouteDecision,
  journeys: DerivedJourney[],
  verified: boolean,
): Promise<void> {
  const heading = verified ? "Verified journeys" : "Verification results (not all passed)";
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
    `## ${heading}`,
    "",
    ...journeys.map((journey) => `- ${verified ? "PASS — " : "NOT VERIFIED — "}${journey.description}`),
    "",
  ].join("\n");
  await writeFile(path.join(appRoot, "summary.md"), summary, "utf8");
}
