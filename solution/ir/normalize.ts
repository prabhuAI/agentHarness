import type { DesignIntent, Genome, NormalizedProductIR, ProductCalculation, ProductEntity, ProductField, ProductFilter, ProductIR } from "./types.js";
import { FIELD_TYPES, GENOMES, type FieldType } from "./types.js";

// Common field-type synonyms weaker models emit, mapped to the runtime's vocabulary.
const FIELD_TYPE_SYNONYMS: Record<string, FieldType> = {
  select: "category", dropdown: "category", choice: "category", enum: "category", multiselect: "category", tags: "category", tag: "category", radio: "category", picklist: "category",
  toggle: "boolean", checkbox: "boolean", bool: "boolean",
  textarea: "longText", multiline: "longText", paragraph: "longText", richtext: "longText",
  string: "text", shorttext: "text", short_text: "text",
  int: "number", integer: "number", float: "number", decimal: "number",
  money: "currency", price: "currency",
  time: "datetime", timestamp: "datetime", "datetime-local": "datetime",
  link: "url", website: "url",
  state: "status", stage: "status",
};

// A field type is coerced, never rejected: valid types pass through, known synonyms
// map to the runtime vocabulary, and an option-bearing field always becomes a choice
// control. This keeps a single mislabeled type (e.g. "select") from failing the whole compile.
function coerceFieldType(raw: unknown, hasOptions: boolean): FieldType {
  const text = String(raw ?? "").trim();
  const known = (FIELD_TYPES as readonly string[]).includes(text)
    ? (text as FieldType)
    : (FIELD_TYPE_SYNONYMS[text.toLowerCase()] ?? (hasOptions ? "category" : "text"));
  return hasOptions && known !== "category" && known !== "status" ? "category" : known;
}

const clean = (value: string): string => value.trim().replace(/\s+/gu, " ");
const identifier = (value: string, fallback: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || fallback;
};
const uniqueStrings = (values: string[]): string[] => [...new Set(values.map(clean).filter(Boolean))];

const includesAny = (text: string, words: string[]): boolean => words.some((word) => text.includes(word));

const DEFAULT_GENOME: Genome = "tracker";
const resolveGenome = (value: unknown): Genome =>
  (GENOMES as readonly string[]).includes(String(value)) ? (value as Genome) : DEFAULT_GENOME;

function inferDesignIntent(input: ProductIR): DesignIntent {
  const product = input.product ?? ({} as ProductIR["product"]);
  const text = `${product.name ?? ""} ${product.description ?? ""} ${product.targetUser ?? ""}`.toLowerCase();
  const genomeDefaults: Record<Genome, DesignIntent> = {
    tracker: { tone: "calm", density: "comfortable", contrast: "balanced", motion: "subtle" },
    workflow: { tone: "professional", density: "compact", contrast: "balanced", motion: "subtle" },
    catalog: { tone: "calm", density: "spacious", contrast: "soft", motion: "subtle" },
    planner: { tone: "warm", density: "comfortable", contrast: "balanced", motion: "subtle" },
    dashboard: { tone: "technical", density: "compact", contrast: "high", motion: "subtle" },
  };
  const inferred = { ...genomeDefaults[resolveGenome(product.genome)] };
  if (includesAny(text, ["family", "parent", "home", "community", "care", "food"])) inferred.tone = "warm";
  if (includesAny(text, ["kid", "game", "party", "creative", "music", "social", "fun"])) inferred.tone = "playful";
  if (includesAny(text, ["wellness", "health", "habit", "mindful", "meditation", "journal"])) inferred.tone = "calm";
  if (includesAny(text, ["developer", "engineering", "api", "system", "analytics", "data", "monitor"])) inferred.tone = "technical";
  if (includesAny(text, ["business", "team", "client", "project", "finance", "operations"])) inferred.tone = "professional";
  if (includesAny(text, ["campaign", "fitness", "challenge", "launch", "sales"])) inferred.tone = "bold";
  if (includesAny(text, ["senior", "elderly", "accessible", "outdoor", "emergency"])) inferred.contrast = "high";
  return product.design ?? inferred;
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
    const type = coerceFieldType(field.type, hasOptions);
    // A category dropdown defaults to accepting custom input when the model didn't say
    // otherwise: it matches the "prefer suggestions with custom input" guidance and keeps
    // an open-ended category (e.g. "kind of book") usable. Status stays a fixed lifecycle.
    const allowCustom = field.allowCustom !== undefined ? field.allowCustom : (type === "category" && hasOptions ? true : undefined);
    return {
      id,
      label: clean(field.label || id),
      type,
      required: Boolean(field.required),
      ...(field.placeholder ? { placeholder: clean(field.placeholder) } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(allowCustom !== undefined ? { allowCustom } : {}),
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
    // The primary field identifies the record, so it is always required — this also
    // guarantees at least one required field for the validation journey.
    const requiredFields = fields.map((field) => field.id === primaryField ? { ...field, required: true } : field);
    return {
      name: clean(entity.name) || `item ${index + 1}`,
      plural: clean(entity.plural) || `${clean(entity.name)}s`,
      primaryField,
      fields: requiredFields,
    };
  }) as [ProductEntity, ...ProductEntity[]];
  const primaryFieldMap = new Map(entities[0].fields.map((field) => [field.id, field]));
  const primaryFields = new Set(primaryFieldMap.keys());
  // Missing capabilities default to a sensible CRUD set rather than rejecting the IR;
  // an explicit false is preserved (?? only fills null/undefined).
  const capabilities = {
    create: input.capabilities?.create ?? true,
    edit: input.capabilities?.edit ?? true,
    delete: input.capabilities?.delete ?? true,
    search: input.capabilities?.search ?? true,
    filter: input.capabilities?.filter ?? false,
    sort: input.capabilities?.sort ?? false,
    group: input.capabilities?.group ?? false,
    transition: input.capabilities?.transition ?? false,
    calculate: input.capabilities?.calculate ?? false,
  };
  let filters = (input.filters ?? [])
    .map((filter, index) => ({ ...filter, id: identifier(filter.id, `filter_${index + 1}`), label: clean(filter.label), field: identifier(filter.field, "") }))
    .filter((filter) => primaryFields.has(filter.field) && (filter.operator !== "equals" || filter.value !== undefined));
  let calculations = (input.calculations ?? [])
    .map((calculation, index) => ({ ...calculation, id: identifier(calculation.id, `metric_${index + 1}`), label: clean(calculation.label), ...(calculation.field ? { field: identifier(calculation.field, "") } : {}) }))
    .filter((calculation) => {
      if (calculation.operation === "count") return true;
      if (!calculation.field || !primaryFields.has(calculation.field)) return false;
      if (calculation.operation !== "sum") return true;
      const type = primaryFieldMap.get(calculation.field)?.type;
      return type === "number" || type === "currency";
    });
  if (capabilities.filter) filters = deriveOptionFilters(entities[0].fields, filters);
  if (capabilities.calculate) calculations = deriveOptionCalculations(entities[0].fields, calculations);
  const name = clean(input.product?.name ?? "") || "Untitled";
  return {
    ...input,
    version: "1",
    product: {
      ...input.product,
      name,
      description: clean(input.product?.description ?? "") || name,
      tagline: clean(input.product?.tagline ?? ""),
      targetUser: clean(input.product?.targetUser ?? "") || "A single user",
      genome: resolveGenome(input.product?.genome),
      accent: /^#[0-9a-f]{6}$/iu.test(input.product?.accent ?? "") ? input.product.accent! : "#5b5bd6",
      design: inferDesignIntent(input),
    },
    entities,
    capabilities,
    filters,
    calculations,
    persistence: { strategy: "localStorage" },
    assumptions: uniqueStrings(input.assumptions ?? []),
    excluded: uniqueStrings(input.excluded ?? []),
    customRequirements: uniqueStrings(input.customRequirements ?? []),
  };
}
