import type { DesignIntent, Genome, NormalizedProductIR, ProductCalculation, ProductEntity, ProductField, ProductFilter, ProductIR } from "./types.js";

const clean = (value: string): string => value.trim().replace(/\s+/gu, " ");
const identifier = (value: string, fallback: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || fallback;
};
const uniqueStrings = (values: string[]): string[] => [...new Set(values.map(clean).filter(Boolean))];

const includesAny = (text: string, words: string[]): boolean => words.some((word) => text.includes(word));

function inferDesignIntent(input: ProductIR): DesignIntent {
  const text = `${input.product.name} ${input.product.description} ${input.product.targetUser}`.toLowerCase();
  const genomeDefaults: Record<Genome, DesignIntent> = {
    tracker: { tone: "calm", density: "comfortable", contrast: "balanced", motion: "subtle" },
    workflow: { tone: "professional", density: "compact", contrast: "balanced", motion: "subtle" },
    catalog: { tone: "calm", density: "spacious", contrast: "soft", motion: "subtle" },
    planner: { tone: "warm", density: "comfortable", contrast: "balanced", motion: "subtle" },
    dashboard: { tone: "technical", density: "compact", contrast: "high", motion: "subtle" },
  };
  const inferred = { ...genomeDefaults[input.product.genome] };
  if (includesAny(text, ["family", "parent", "home", "community", "care", "food"])) inferred.tone = "warm";
  if (includesAny(text, ["kid", "game", "party", "creative", "music", "social", "fun"])) inferred.tone = "playful";
  if (includesAny(text, ["wellness", "health", "habit", "mindful", "meditation", "journal"])) inferred.tone = "calm";
  if (includesAny(text, ["developer", "engineering", "api", "system", "analytics", "data", "monitor"])) inferred.tone = "technical";
  if (includesAny(text, ["business", "team", "client", "project", "finance", "operations"])) inferred.tone = "professional";
  if (includesAny(text, ["campaign", "fitness", "challenge", "launch", "sales"])) inferred.tone = "bold";
  if (includesAny(text, ["senior", "elderly", "accessible", "outdoor", "emergency"])) inferred.contrast = "high";
  return input.product.design ?? inferred;
}

function normalizeFields(entity: ProductEntity): ProductField[] {
  const seen = new Set<string>();
  const normalized = entity.fields.map((field, index) => {
    let id = identifier(field.id || field.label, `field_${index + 1}`);
    while (seen.has(id)) id = `${id}_${index + 1}`;
    seen.add(id);
    const options = field.options ? uniqueStrings(field.options) : undefined;
    // A field carrying an enumerated option list is a choice control regardless of
    // the type the model tagged it with. Weaker models often emit `text` with
    // `options`; coercing to `category` makes the runtime render a select and lets
    // the compiler derive per-option filters and counts.
    const hasOptions = Boolean(options && options.length > 0);
    const type = hasOptions && field.type !== "category" && field.type !== "status" ? "category" : field.type;
    return {
      id,
      label: clean(field.label || id),
      type,
      required: Boolean(field.required),
      ...(field.placeholder ? { placeholder: clean(field.placeholder) } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(field.allowCustom !== undefined ? { allowCustom: field.allowCustom } : {}),
      ...(Number.isFinite(field.min) ? { min: field.min } : {}),
      ...(Number.isFinite(field.max) ? { max: field.max } : {}),
    };
  });
  const normalizedIds = new Set(normalized.map((field) => field.id));
  return normalized.map((field, index) => {
    const condition = entity.fields[index]?.visibleWhen;
    if (!condition) return field;
    const controllingField = identifier(condition.field, "");
    const equals = clean(condition.equals);
    if (!normalizedIds.has(controllingField) || controllingField === field.id || !equals) return field;
    return { ...field, visibleWhen: { field: controllingField, equals } };
  });
}

const OPTION_DERIVATION_RANGE = { min: 2, max: 8 };

// Category/status options are mechanically enumerable from the field itself, so the
// compiler derives one filter/count per option here instead of requiring the model to
// spell each one out — cutting output tokens without losing behavior.
function deriveOptionFilters(fields: ProductField[], filters: ProductFilter[]): ProductFilter[] {
  const derived = [...filters];
  const seen = new Set(derived.map((filter) => `${filter.field}:${filter.operator}:${filter.value ?? ""}`));
  for (const field of fields) {
    if (field.type !== "category" && field.type !== "status") continue;
    const options = field.options ?? [];
    if (options.length < OPTION_DERIVATION_RANGE.min || options.length > OPTION_DERIVATION_RANGE.max) continue;
    for (const option of options) {
      const key = `${field.id}:equals:${option}`;
      if (seen.has(key)) continue;
      seen.add(key);
      derived.push({ id: identifier(`${field.id}_${option}`, `filter_${derived.length + 1}`), label: option, field: field.id, operator: "equals", value: option });
    }
  }
  return derived;
}

function deriveOptionCalculations(fields: ProductField[], calculations: ProductCalculation[]): ProductCalculation[] {
  const derived = [...calculations];
  const seen = new Set(derived.map((calculation) => `${calculation.field ?? ""}:${calculation.operation}:${calculation.operator ?? ""}:${calculation.value ?? ""}`));
  for (const field of fields) {
    if (field.type !== "category" && field.type !== "status") continue;
    const options = field.options ?? [];
    if (options.length < OPTION_DERIVATION_RANGE.min || options.length > OPTION_DERIVATION_RANGE.max) continue;
    for (const option of options) {
      const key = `${field.id}:countWhere:equals:${option}`;
      if (seen.has(key)) continue;
      seen.add(key);
      derived.push({ id: identifier(`${field.id}_${option}_count`, `metric_${derived.length + 1}`), label: option, operation: "countWhere", field: field.id, operator: "equals", value: option });
    }
  }
  return derived;
}

export function normalizeProductIR(input: ProductIR): NormalizedProductIR {
  const entities = input.entities.map((entity, index) => {
    const fields = normalizeFields(entity);
    const requestedPrimary = identifier(entity.primaryField, fields[0]?.id ?? "name");
    const primaryField = fields.some((field) => field.id === requestedPrimary) ? requestedPrimary : (fields[0]?.id ?? "name");
    return {
      name: clean(entity.name) || `item ${index + 1}`,
      plural: clean(entity.plural) || `${clean(entity.name)}s`,
      primaryField,
      fields,
    };
  }) as [ProductEntity, ...ProductEntity[]];
  const primaryFieldMap = new Map(entities[0].fields.map((field) => [field.id, field]));
  const primaryFields = new Set(primaryFieldMap.keys());
  let filters = input.filters
    .map((filter, index) => ({ ...filter, id: identifier(filter.id, `filter_${index + 1}`), label: clean(filter.label), field: identifier(filter.field, "") }))
    .filter((filter) => primaryFields.has(filter.field) && (filter.operator !== "equals" || filter.value !== undefined));
  let calculations = input.calculations
    .map((calculation, index) => ({ ...calculation, id: identifier(calculation.id, `metric_${index + 1}`), label: clean(calculation.label), ...(calculation.field ? { field: identifier(calculation.field, "") } : {}) }))
    .filter((calculation) => {
      if (calculation.operation === "count") return true;
      if (!calculation.field || !primaryFields.has(calculation.field)) return false;
      if (calculation.operation !== "sum") return true;
      const type = primaryFieldMap.get(calculation.field)?.type;
      return type === "number" || type === "currency";
    });
  if (input.capabilities.filter) filters = deriveOptionFilters(entities[0].fields, filters);
  if (input.capabilities.calculate) calculations = deriveOptionCalculations(entities[0].fields, calculations);
  return {
    ...input,
    version: "1",
    product: {
      ...input.product,
      name: clean(input.product.name),
      description: clean(input.product.description),
      tagline: clean(input.product.tagline ?? ""),
      targetUser: clean(input.product.targetUser),
      accent: /^#[0-9a-f]{6}$/iu.test(input.product.accent ?? "") ? input.product.accent! : "#5b5bd6",
      design: inferDesignIntent(input),
    },
    entities,
    filters,
    calculations,
    persistence: { strategy: "localStorage" },
    assumptions: uniqueStrings(input.assumptions),
    excluded: uniqueStrings(input.excluded),
    customRequirements: uniqueStrings(input.customRequirements),
  };
}
