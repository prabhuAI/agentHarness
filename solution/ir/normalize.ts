import type { DateWindowOperator, DerivedFieldSpec, DesignIntent, FilterOperator, Genome, NormalizedProductIR, ProductCalculation, ProductEntity, ProductField, ProductFilter, ProductIR } from "./types.js";
import { DATE_WINDOW_OPERATORS, DERIVED_FIELD_KINDS, FIELD_TYPES, FILTER_OPERATORS, GENOMES, type FieldType } from "./types.js";

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

// Resolve and sanitize a field's derive spec against the normalized field ids.
// Returns undefined (dropping the spec so the field degrades to a plain manual
// field) when the shape is unusable: unknown kind, dangling date/threshold
// reference, self-reference, or no usable threshold. Field-id references are run
// through `identifier` so they match the normalized ids exactly.
function normalizeDerive(raw: unknown, fieldId: string, fieldIds: Set<string>): DerivedFieldSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const spec = raw as Partial<DerivedFieldSpec> & { buckets?: Partial<DerivedFieldSpec["buckets"]> };
  if (!(DERIVED_FIELD_KINDS as readonly string[]).includes(String(spec.kind))) return undefined;
  const dateField = identifier(String(spec.dateField ?? ""), "");
  if (!fieldIds.has(dateField) || dateField === fieldId) return undefined;
  const thresholdField = spec.thresholdField !== undefined ? identifier(String(spec.thresholdField), "") : "";
  const hasThresholdField = Boolean(thresholdField) && fieldIds.has(thresholdField) && thresholdField !== fieldId;
  const thresholdDays = Number(spec.thresholdDays);
  if (!hasThresholdField && !Number.isFinite(thresholdDays)) return undefined;
  const buckets: Partial<DerivedFieldSpec["buckets"]> = spec.buckets ?? {};
  const overdue = clean(String(buckets.overdue ?? ""));
  const soon = clean(String(buckets.soon ?? ""));
  const ok = clean(String(buckets.ok ?? ""));
  if (!overdue || !soon || !ok) return undefined;
  const soonWithinDays = Number(spec.soonWithinDays);
  return {
    kind: "dateThreshold",
    dateField,
    ...(hasThresholdField ? { thresholdField } : { thresholdDays: Math.max(0, Math.trunc(thresholdDays)) }),
    ...(Number.isFinite(soonWithinDays) && soonWithinDays > 0 ? { soonWithinDays: Math.trunc(soonWithinDays) } : {}),
    buckets: { overdue, soon, ok },
  };
}

function normalizeFields(entity: ProductEntity): ProductField[] {
  const seen = new Set<string>();
  const normalized = entity.fields.map((field, index) => {
    let id = identifier(field.id || field.label, `field_${index + 1}`);
    while (seen.has(id)) id = `${id}_${index + 1}`;
    seen.add(id);
    let options = field.options ? uniqueStrings(field.options) : undefined;
    // A derived field is computed at read time, so it is a fixed lifecycle (status)
    // whose values are exactly its buckets. Fold the bucket labels into its options
    // (dedup-preserving) so the facet machinery derives per-band filters and counts,
    // and so a model that omitted options still gets a usable choice set.
    const rawDerive = (field as ProductField).derive;
    if (rawDerive && typeof rawDerive === "object" && rawDerive.buckets) {
      const bands = [rawDerive.buckets.overdue, rawDerive.buckets.soon, rawDerive.buckets.ok].filter((value): value is string => typeof value === "string");
      options = uniqueStrings([...(options ?? []), ...bands]);
    }
    // A field carrying an enumerated option list is a choice control regardless of
    // the type the model tagged it with. Weaker models often emit `text` with
    // `options`; coercing to `category` makes the runtime render a select and lets
    // the compiler derive per-option filters and counts.
    const hasOptions = Boolean(options && options.length > 0);
    let type = coerceFieldType(field.type, hasOptions);
    // A derived bucket field is a computed lifecycle: force `status` so it groups,
    // filters, and badges like one — never a free-text or category input.
    if (rawDerive) type = "status";
    // A category dropdown defaults to accepting custom input when the model didn't say
    // otherwise: it matches the "prefer suggestions with custom input" guidance and keeps
    // an open-ended category (e.g. "kind of book") usable. Status stays a fixed lifecycle.
    const allowCustom = field.allowCustom !== undefined ? field.allowCustom : (type === "category" && hasOptions ? true : undefined);
    return {
      id,
      label: clean(field.label || id),
      type,
      // A computed field can never be user-required — there is no input to fill.
      required: rawDerive ? false : Boolean(field.required),
      ...(field.placeholder ? { placeholder: clean(field.placeholder) } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(allowCustom !== undefined ? { allowCustom } : {}),
      ...(Number.isFinite(field.min) ? { min: field.min } : {}),
      ...(Number.isFinite(field.max) ? { max: field.max } : {}),
    };
  });
  const normalizedIds = new Set(normalized.map((field) => field.id));
  return normalized.map((field, index) => {
    const source = entity.fields[index];
    let result: ProductField = field;
    const condition = source?.visibleWhen;
    if (condition) {
      const controllingField = identifier(condition.field, "");
      const equals = clean(condition.equals);
      if (normalizedIds.has(controllingField) && controllingField !== field.id && equals) {
        result = { ...result, visibleWhen: { field: controllingField, equals } };
      }
    }
    const derive = normalizeDerive((source as ProductField | undefined)?.derive, field.id, normalizedIds);
    if (derive) result = { ...result, derive };
    return result;
  });
}

const OPTION_DERIVATION_RANGE = { min: 2, max: 8 };

// The single field whose options are worth exposing as filter chips / stat tiles:
// a status lifecycle when present (the item's core state, e.g. On shelf / Lent
// out), otherwise one category. Enumerating every option of every category/status
// field produced a cluttered, redundant filter set (one chip per genre, per
// status, per boolean); other categories stay reachable through grouping and
// search. This keeps the derived UI short and meaningful.
function primaryFacetField(fields: ProductField[]): ProductField | undefined {
  const inRange = (field: ProductField) => {
    const count = field.options?.length ?? 0;
    return count >= OPTION_DERIVATION_RANGE.min && count <= OPTION_DERIVATION_RANGE.max;
  };
  return fields.find((field) => field.type === "status" && inRange(field))
    ?? fields.find((field) => field.type === "category" && inRange(field));
}

function deriveOptionFilters(fields: ProductField[], filters: ProductFilter[]): ProductFilter[] {
  const field = primaryFacetField(fields);
  if (!field) return filters;
  const derived = [...filters];
  const seen = new Set(derived.map((filter) => `${filter.field}:${filter.operator}:${filter.value ?? ""}`));
  for (const option of field.options ?? []) {
    const key = `${field.id}:equals:${option}`;
    if (seen.has(key)) continue;
    seen.add(key);
    derived.push({ id: identifier(`${field.id}_${option}`, `filter_${derived.length + 1}`), label: option, field: field.id, operator: "equals", value: option });
  }
  return derived;
}

// A currency field is the natural "measure" to total per facet option — money is
// what a breakdown sums. Plain numbers (reps, weight, duration) are not summed as
// a headline, so only currency triggers a per-option spend breakdown.
function measureField(fields: ProductField[]): ProductField | undefined {
  return fields.find((field) => field.type === "currency");
}

const calcKey = (calculation: Pick<ProductCalculation, "field" | "operation" | "operator" | "value" | "sumField">): string =>
  `${calculation.field ?? ""}:${calculation.operation}:${calculation.operator ?? ""}:${calculation.value ?? ""}:${calculation.sumField ?? ""}`;

// Per facet option, derive one summary metric. When the entity has a currency
// measure, that metric is the option's summed spend (sumWhere) — the "total
// broken down by category" a spend tracker asks for. With no measure it stays a
// per-option count, as before, so non-money trackers are unaffected.
function deriveOptionCalculations(fields: ProductField[], calculations: ProductCalculation[]): ProductCalculation[] {
  const field = primaryFacetField(fields);
  if (!field) return calculations;
  const measure = measureField(fields);
  const derived = [...calculations];
  const seen = new Set(derived.map(calcKey));
  for (const option of field.options ?? []) {
    const metric: ProductCalculation = measure
      ? { id: identifier(`${field.id}_${option}_${measure.id}`, `metric_${derived.length + 1}`), label: option, operation: "sumWhere", field: field.id, operator: "equals", value: option, sumField: measure.id }
      : { id: identifier(`${field.id}_${option}_count`, `metric_${derived.length + 1}`), label: option, operation: "countWhere", field: field.id, operator: "equals", value: option };
    const key = calcKey(metric);
    if (seen.has(key)) continue;
    seen.add(key);
    derived.push(metric);
  }
  return derived;
}

// A predicate is usable only if its field exists, an `equals` carries a value,
// and a date-window operator targets an actual date field. Dropping the rest
// stops a model's malformed filter/metric (e.g. countWhere on a field with no
// value, or `equals "thisMonth"`) from shipping as a dead or misleading control.
function predicateUsable(fieldId: string | undefined, operator: FilterOperator | undefined, value: string | undefined, fieldMap: Map<string, ProductField>): boolean {
  if (!fieldId || !fieldMap.has(fieldId)) return false;
  // No operator means no real predicate — a countWhere/sumWhere without one would
  // silently default to "nonEmpty" and count/sum every record under a specific
  // label (the "Food this month" that was really an all-records total). Drop it.
  if (!operator || !(FILTER_OPERATORS as readonly string[]).includes(operator)) return false;
  if ((DATE_WINDOW_OPERATORS as readonly string[]).includes(operator)) {
    const type = fieldMap.get(fieldId)?.type;
    return type === "date" || type === "datetime";
  }
  if (operator === "equals") return value !== undefined && value !== "";
  return true;
}

// Map a model's date-window shorthand (often emitted as a fake value like
// `equals "this month"`) to the runtime's real window operator.
const DATE_WINDOW_KEYWORDS: Record<string, DateWindowOperator> = {
  today: "today", thisday: "today",
  thisweek: "thisWeek", week: "thisWeek", currentweek: "thisWeek",
  thismonth: "thisMonth", month: "thisMonth", currentmonth: "thisMonth",
};
const windowKeyword = (value: string | undefined): DateWindowOperator | undefined =>
  value ? DATE_WINDOW_KEYWORDS[value.toLowerCase().replace(/[^a-z]/gu, "")] : undefined;

export function normalizeProductIR(input: ProductIR): NormalizedProductIR {
  const entities = input.entities.map((entity, index) => {
    const fields = normalizeFields(entity);
    // A derived field is computed, never entered, so it can never identify a record.
    const enterable = fields.filter((field) => !field.derive);
    const requestedPrimary = identifier(entity.primaryField, enterable[0]?.id ?? fields[0]?.id ?? "name");
    const primaryField = enterable.some((field) => field.id === requestedPrimary) ? requestedPrimary : (enterable[0]?.id ?? fields[0]?.id ?? "name");
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
  // A category/status field with a small fixed option set is, by construction, a
  // facet you can filter, group, and summarize by — that is the whole point of
  // enumerating its options. So a facet deterministically implies filter, group,
  // and calculate, even when the model under-scoped the idea and left them off
  // (which stranded the option list with no way to browse or break down by it).
  const hasFacet = Boolean(primaryFacetField(entities[0].fields));
  // Missing capabilities default to a sensible CRUD set rather than rejecting the IR;
  // an explicit false is preserved (?? only fills null/undefined) unless a facet forces it on.
  const capabilities = {
    create: input.capabilities?.create ?? true,
    edit: input.capabilities?.edit ?? true,
    delete: input.capabilities?.delete ?? true,
    search: input.capabilities?.search ?? true,
    filter: (input.capabilities?.filter ?? false) || hasFacet,
    sort: input.capabilities?.sort ?? false,
    group: (input.capabilities?.group ?? false) || hasFacet,
    transition: input.capabilities?.transition ?? false,
    calculate: (input.capabilities?.calculate ?? false) || hasFacet,
  };
  const isNumeric = (fieldId: string | undefined): boolean => {
    const type = fieldId ? primaryFieldMap.get(fieldId)?.type : undefined;
    return type === "number" || type === "currency";
  };
  let filters = (input.filters ?? [])
    .map((filter, index): ProductFilter => {
      const field = identifier(filter.field, "");
      const type = primaryFieldMap.get(field)?.type;
      const base = { id: identifier(filter.id, `filter_${index + 1}`), label: clean(filter.label), field };
      // Repair a model that expressed a date window as a fake value (equals
      // "thisMonth") into the real window operator so it actually filters.
      const asWindow = windowKeyword(filter.value);
      if (asWindow && (type === "date" || type === "datetime")) return { ...base, operator: asWindow };
      return { ...base, operator: filter.operator, ...(filter.value !== undefined ? { value: filter.value } : {}) };
    })
    .filter((filter) => predicateUsable(filter.field, filter.operator, filter.value, primaryFieldMap));
  let calculations = (input.calculations ?? [])
    .map((calculation, index) => ({ ...calculation, id: identifier(calculation.id, `metric_${index + 1}`), label: clean(calculation.label), ...(calculation.field ? { field: identifier(calculation.field, "") } : {}), ...(calculation.sumField ? { sumField: identifier(calculation.sumField, "") } : {}) }))
    .filter((calculation) => {
      if (calculation.operation === "count") return true;
      if (calculation.operation === "sum") return isNumeric(calculation.field);
      if (calculation.operation === "sumWhere") return isNumeric(calculation.sumField) && predicateUsable(calculation.field, calculation.operator, calculation.value, primaryFieldMap);
      // countWhere: a genuine predicate over a real field, never a bare no-value count.
      return predicateUsable(calculation.field, calculation.operator, calculation.value, primaryFieldMap);
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
