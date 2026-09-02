import { analyzeFormula } from "./formula.js";
import type { ChartType, DateThresholdDerive, DateWindowOperator, DerivedFieldSpec, DesignIntent, FilterOperator, Genome, NormalizedProductIR, ProductCalculation, ProductChart, ProductEntity, ProductField, ProductFilter, ProductIR, ProductPriority, ProductQuickAction, ProductRangeConflict, ProductStandings } from "./types.js";
import { CHART_TYPES, DATE_COMPARISON_OPERATORS, DATE_WINDOW_OPERATORS, DERIVED_FIELD_KINDS, FIELD_TYPES, FILTER_OPERATORS, GENOMES, QUICK_ACTION_SETS, type FieldType } from "./types.js";

// Operators that require a non-empty comparison `value` (between additionally
// requires `valueEnd`, checked separately). nonEmpty/empty/truthy/falsy and the
// date-window operators carry no value and are absent here.
const VALUE_OPERATORS = new Set<FilterOperator>([
  "equals", "notEquals", "contains", "greaterThan", "lessThan", "atLeast", "atMost",
]);

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
const identifier = (value: unknown, fallback: string): string => {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
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
    ledger: { tone: "professional", density: "compact", contrast: "high", motion: "subtle" },
    directory: { tone: "calm", density: "comfortable", contrast: "balanced", motion: "subtle" },
    log: { tone: "calm", density: "comfortable", contrast: "balanced", motion: "subtle" },
    inventory: { tone: "professional", density: "compact", contrast: "balanced", motion: "subtle" },
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
// reference, self-reference, no usable threshold, or a formula that does not
// parse or references a missing/non-numeric field. Field-id references are run
// through `identifier` so they match the normalized ids exactly.
function normalizeDerive(
  raw: unknown,
  fieldId: string,
  fieldIds: Set<string>,
  numericIds: Set<string>,
  fieldTypes: Map<string, ProductField["type"]>,
): DerivedFieldSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const spec = raw as { kind?: unknown; dateField?: unknown; thresholdField?: unknown; thresholdDays?: unknown; soonWithinDays?: unknown; buckets?: Partial<DateThresholdDerive["buckets"]>; expression?: unknown };
  const kind = String(spec.kind);
  if (!(DERIVED_FIELD_KINDS as readonly string[]).includes(kind)) return undefined;
  if (kind === "presence") {
    // A presence lifecycle needs a real sibling source field (not itself) and
    // two distinct labels; otherwise it degrades to a plain manual field.
    const presence = raw as { sourceField?: unknown; whenPresent?: unknown; whenEmpty?: unknown };
    const sourceField = identifier(String(presence.sourceField ?? ""), "");
    if (!fieldIds.has(sourceField) || sourceField === fieldId) return undefined;
    const whenPresent = clean(String(presence.whenPresent ?? ""));
    const whenEmpty = clean(String(presence.whenEmpty ?? ""));
    if (!whenPresent || !whenEmpty || whenPresent === whenEmpty) return undefined;
    return { kind: "presence", sourceField, whenPresent, whenEmpty };
  }
  if (kind === "rangeStatus") {
    const range = raw as { startField?: unknown; endField?: unknown; completedField?: unknown; inactiveField?: unknown; buckets?: Record<string, unknown> };
    const startField = identifier(range.startField, "");
    const endField = identifier(range.endField, "");
    const completedField = identifier(range.completedField, "");
    const inactiveField = identifier(range.inactiveField, "");
    if (!fieldIds.has(startField) || !fieldIds.has(endField) || startField === endField || startField === fieldId || endField === fieldId) return undefined;
    if (!["date", "datetime"].includes(fieldTypes.get(startField) ?? "") || !["date", "datetime"].includes(fieldTypes.get(endField) ?? "")) return undefined;
    if (completedField && (!fieldIds.has(completedField) || completedField === fieldId)) return undefined;
    if (completedField && (completedField === startField || completedField === endField)) return undefined;
    if (completedField && !["date", "datetime"].includes(fieldTypes.get(completedField) ?? "")) return undefined;
    if (inactiveField && (!fieldIds.has(inactiveField) || inactiveField === fieldId)) return undefined;
    if (inactiveField && fieldTypes.get(inactiveField) !== "boolean") return undefined;
    const upcoming = clean(String(range.buckets?.upcoming ?? ""));
    const active = clean(String(range.buckets?.active ?? ""));
    const past = clean(String(range.buckets?.past ?? ""));
    const completed = clean(String(range.buckets?.completed ?? ""));
    const inactive = clean(String(range.buckets?.inactive ?? ""));
    if (!upcoming || !active || !past || (completedField && !completed) || (inactiveField && !inactive)) return undefined;
    return {
      kind: "rangeStatus", startField, endField,
      ...(completedField ? { completedField } : {}),
      ...(inactiveField ? { inactiveField } : {}),
      buckets: { upcoming, active, past, ...(completed ? { completed } : {}), ...(inactive ? { inactive } : {}) },
    };
  }
  if (kind === "formula") {
    const expression = clean(String(spec.expression ?? ""));
    if (!expression) return undefined;
    const analyzed = analyzeFormula(expression);
    // A usable formula parses and references only real numeric sibling fields
    // (never itself, never a non-numeric or missing field, and at least one).
    if (!analyzed || analyzed.ids.length === 0) return undefined;
    if (analyzed.ids.some((id) => id === fieldId || !numericIds.has(id))) return undefined;
    return { kind: "formula", expression };
  }
  const dateField = identifier(String(spec.dateField ?? ""), "");
  if (!fieldIds.has(dateField) || dateField === fieldId) return undefined;
  const thresholdField = spec.thresholdField !== undefined ? identifier(String(spec.thresholdField), "") : "";
  const hasThresholdField = Boolean(thresholdField) && fieldIds.has(thresholdField) && thresholdField !== fieldId;
  const thresholdDays = Number(spec.thresholdDays);
  if (!hasThresholdField && !Number.isFinite(thresholdDays)) return undefined;
  const buckets: Partial<DateThresholdDerive["buckets"]> = spec.buckets ?? {};
  const overdue = clean(String(buckets.overdue ?? ""));
  const soon = clean(String(buckets.soon ?? ""));
  const ok = clean(String(buckets.ok ?? ""));
  if (!overdue || !soon || !ok) return undefined;
  // A three-band derivation whose every bucket is identical computes no state at
  // all. Drop it so a model-authored manual lifecycle remains editable instead
  // of becoming a permanently fixed status.
  if (new Set([overdue.toLowerCase(), soon.toLowerCase(), ok.toLowerCase()]).size < 2) return undefined;
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
    const deriveKind = rawDerive && typeof rawDerive === "object" ? String((rawDerive as { kind?: unknown }).kind) : "";
    const buckets = (rawDerive as { buckets?: Partial<DateThresholdDerive["buckets"]> } | undefined)?.buckets;
    const isPresenceDerive = deriveKind === "presence";
    const isFormulaDerive = deriveKind === "formula";
    const isRangeStatusDerive = deriveKind === "rangeStatus";
    // Only a date-threshold lifecycle folds its bucket labels into options (so the
    // facet machinery derives per-band filters and counts); a formula stays numeric.
    const isDateThresholdDerive = deriveKind === "dateThreshold" || (!isPresenceDerive && !isFormulaDerive && !isRangeStatusDerive && Boolean(buckets));
    if (isDateThresholdDerive && buckets) {
      const bands = [buckets.overdue, buckets.soon, buckets.ok].filter((value): value is string => typeof value === "string");
      options = uniqueStrings([...(options ?? []), ...bands]);
    }
    // A presence lifecycle's options are exactly its two computed labels, in the
    // order [empty, present] so the "resting" state reads first as a filter chip.
    // Fold them in so the facet machinery derives per-state filters and counts.
    if (isPresenceDerive) {
      const presence = rawDerive as { whenEmpty?: unknown; whenPresent?: unknown };
      const labels = [presence.whenEmpty, presence.whenPresent].filter((value): value is string => typeof value === "string" && value.trim() !== "");
      options = uniqueStrings([...(options ?? []), ...labels]);
    }
    if (isRangeStatusDerive) {
      const rangeBuckets = (rawDerive as { buckets?: Record<string, unknown> }).buckets;
      const labels = [rangeBuckets?.upcoming, rangeBuckets?.active, rangeBuckets?.past, rangeBuckets?.completed, rangeBuckets?.inactive]
        .filter((value): value is string => typeof value === "string" && value.trim() !== "");
      options = uniqueStrings([...(options ?? []), ...labels]);
    }
    // A field carrying an enumerated option list is a choice control regardless of
    // the type the model tagged it with. Weaker models often emit `text` with
    // `options`; coercing to `category` makes the runtime render a select and lets
    // the compiler derive per-option filters and counts.
    const hasOptions = Boolean(options && options.length > 0);
    let type = coerceFieldType(field.type, hasOptions);
    // A date-threshold field is a computed lifecycle: force `status` so it groups,
    // filters, and badges like one. A formula field is a computed number: force a
    // numeric type so it renders and sums as a number, never a free-text input.
    if (isDateThresholdDerive || isPresenceDerive || isRangeStatusDerive) type = "status";
    else if (isFormulaDerive) type = field.type === "currency" ? "currency" : "number";
    // A category dropdown defaults to accepting custom input when the model didn't say
    // otherwise: it matches the "prefer suggestions with custom input" guidance and keeps
    // an open-ended category (e.g. "kind of book") usable. Status stays a fixed lifecycle.
    const allowCustom = field.allowCustom !== undefined ? field.allowCustom : (type === "category" && hasOptions ? true : undefined);
    // A reference field carries the target entity name; it is validated against
    // the full entity set in a later pass (unresolved → degraded to plain text).
    const refEntity = type === "reference" ? clean(String((field as ProductField).refEntity ?? "")) : "";
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
      ...(refEntity ? { refEntity } : {}),
    };
  });
  const normalizedIds = new Set(normalized.map((field) => field.id));
  const fieldTypes = new Map(normalized.map((field) => [field.id, field.type]));
  // A formula may reference only genuine numeric input fields — not itself, not a
  // date/text field, and not another computed field (which is not in stored values).
  const numericIds = new Set(
    normalized
      .filter((field, index) => (field.type === "number" || field.type === "currency") && !(entity.fields[index] as ProductField | undefined)?.derive)
      .map((field) => field.id),
  );
  return normalized.map((field, index) => {
    const source = entity.fields[index];
    let result: ProductField = field;
    const condition = source?.visibleWhen;
    if (condition) {
      const controllingField = identifier(condition.field, "");
      // condition.equals may be absent on a model-emitted partial visibleWhen;
      // coerce defensively so an incomplete condition degrades (drops) rather than
      // throwing. The `equals` truthiness check below then omits it entirely.
      const equals = clean(String(condition.equals ?? ""));
      if (normalizedIds.has(controllingField) && controllingField !== field.id && equals) {
        result = { ...result, visibleWhen: { field: controllingField, equals } };
      }
    }
    const derive = normalizeDerive((source as ProductField | undefined)?.derive, field.id, normalizedIds, numericIds, fieldTypes);
    if (derive) result = { ...result, derive };
    return result;
  });
}

const RANGE_CONFLICT_PATTERN = /(overlap|double[ -]?book|booking conflict|reservation conflict|same .{0,24}(?:period|date|time)|available before)/iu;

function normalizeRangeConflicts(input: ProductIR, entities: ProductEntity[]): ProductRangeConflict[] {
  const entityMap = new Map(entities.map((entity) => [identifier(entity.name, ""), entity]));
  const normalizeOne = (raw: Partial<ProductRangeConflict>, index: number): ProductRangeConflict | undefined => {
    const entityName = identifier(raw.entity ?? entities[0]?.name, "");
    const entity = entityMap.get(entityName);
    if (!entity) return undefined;
    const fields = new Map(entity.fields.map((field) => [field.id, field]));
    const matchField = identifier(raw.matchField, "");
    const startField = identifier(raw.startField, "");
    const endField = identifier(raw.endField, "");
    const start = fields.get(startField);
    const end = fields.get(endField);
    const match = fields.get(matchField);
    if (!match || !start || !end || startField === endField) return undefined;
    if (!(["date", "datetime"] as const).includes(start.type as "date" | "datetime") ||
      !(["date", "datetime"] as const).includes(end.type as "date" | "datetime")) return undefined;
    const rawIgnore = raw.ignoreWhen;
    const ignoreField = rawIgnore ? identifier(rawIgnore.field, "") : "";
    const ignoreTarget = fields.get(ignoreField);
    const requestedValues = uniqueStrings(rawIgnore?.values ?? []);
    const canonicalValues = requestedValues.map((value) =>
      ignoreTarget?.options?.find((option) => option.toLowerCase() === value.toLowerCase()) ?? value);
    const detailFields = [...new Set((raw.detailFields ?? []).map((field) => identifier(field, "")))]
      .filter((field) => field !== matchField && field !== startField && field !== endField && fields.has(field))
      .slice(0, 3);
    return {
      id: identifier(raw.id, `range_conflict_${index + 1}`),
      entity: entity.name,
      matchField,
      startField,
      endField,
      ...(ignoreTarget && canonicalValues.length > 0 ? { ignoreWhen: { field: ignoreField, values: canonicalValues } } : {}),
      ...(detailFields.length > 0 ? { detailFields } : {}),
    };
  };

  const explicit = (input.rangeConflicts ?? [])
    .map((rule, index) => normalizeOne(rule, index))
    .filter((rule): rule is ProductRangeConflict => Boolean(rule));
  if (explicit.length > 0) return explicit.filter((rule, index, all) =>
    all.findIndex((candidate) => `${candidate.entity}:${candidate.matchField}:${candidate.startField}:${candidate.endField}` ===
      `${rule.entity}:${rule.matchField}:${rule.startField}:${rule.endField}`) === index);

  // Compatibility fallback for models that describe this common invariant in
  // prose. Inference is intentionally strict: conflict language plus one entity
  // with an identifiable start field, end field, and resource-like match field.
  const prose = `${input.product?.description ?? ""} ${(input.customRequirements ?? []).join(" ")}`;
  if (!RANGE_CONFLICT_PATTERN.test(prose)) return [];
  const semantic = (field: ProductField): string => `${field.id} ${field.label}`.toLowerCase();
  for (const entity of entities) {
    const start = entity.fields.find((field) => (field.type === "date" || field.type === "datetime") && /(^|\W)(start|from|begin|pickup|check[ -]?in)(\W|$)/u.test(semantic(field)));
    const end = entity.fields.find((field) => (field.type === "date" || field.type === "datetime") && /(^|\W)(end|until|return|due|dropoff|check[ -]?out)(\W|$)/u.test(semantic(field)));
    const match = entity.fields.find((field) => ["text", "category", "reference"].includes(field.type) && /(^|\W)(item|equipment|resource|asset|room|vehicle|property|unit|seat|camera|lens)(\W|$)/u.test(semantic(field)));
    if (!start || !end || !match || start.id === end.id) continue;
    const ignoredField = entity.fields.find((field) => (field.type === "status" || field.type === "category") &&
      field.options?.some((option) => /^cancell?ed$/iu.test(option)));
    const ignoredValues = ignoredField?.options?.filter((option) => /^cancell?ed$/iu.test(option)) ?? [];
    const detailFields = entity.fields
      .filter((field) => field.id !== match.id && ["text", "email"].includes(field.type))
      .sort((left, right) => Number(!/customer|client|guest|owner|assignee/iu.test(semantic(left))) - Number(!/customer|client|guest|owner|assignee/iu.test(semantic(right))))
      .slice(0, 2)
      .map((field) => field.id);
    const inferred = normalizeOne({
      id: "no_overlapping_ranges",
      entity: entity.name,
      matchField: match.id,
      startField: start.id,
      endField: end.id,
      ...(ignoredField && ignoredValues.length > 0 ? { ignoreWhen: { field: ignoredField.id, values: ignoredValues } } : {}),
      detailFields,
    }, 0);
    return inferred ? [inferred] : [];
  }
  return [];
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

// Filter chips are identified by their visible label (the runtime renders one
// button per filter, and both the UI and the accessibility tree key off the
// label). Two filters that share a label — e.g. a model that writes an explicit
// "Running low" filter and also carries a "Running low" status option that
// auto-derives its own band filter — collide into duplicate buttons, which
// breaks the filter journey (an ambiguous getByRole) and confuses the user.
// Keep the first occurrence: explicit model filters precede derived per-option
// ones, so an intentional filter always wins over an auto-derived duplicate.
function dedupeFiltersByLabel(filters: ProductFilter[]): ProductFilter[] {
  const seen = new Set<string>();
  return filters.filter((filter) => {
    const key = clean(filter.label).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

const calcKey = (calculation: Pick<ProductCalculation, "entity" | "field" | "operation" | "operator" | "value" | "sumField">): string =>
  `${calculation.entity ?? ""}:${calculation.field ?? ""}:${calculation.operation}:${calculation.operator ?? ""}:${calculation.value ?? ""}:${calculation.sumField ?? ""}`;

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

// Metric labels are the user-facing identity in the summary strip. Prefer an
// explicit model-authored metric over a later auto-derived facet metric when
// both have the same label; rendering duplicates is confusing and used to make
// configuration-driven UI tests ambiguous.
function dedupeCalculationsByLabel(calculations: ProductCalculation[], defaultEntity: string): ProductCalculation[] {
  const seen = new Set<string>();
  return calculations.filter((calculation) => {
    const key = `${calculation.entity ?? defaultEntity}:${clean(calculation.label).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function impliedActiveStatus(field: ProductField | undefined, label: string): string | undefined {
  if (!field || field.type !== "status" || !/(current|active|in[ _-]?progress|ongoing)/iu.test(label)) return undefined;
  const activeWords = new Set(["active", "out", "rented", "checked out", "in progress", "ongoing"]);
  return field.options?.find((option) => activeWords.has(option.trim().toLowerCase()));
}

// A predicate is usable only if its field exists, an `equals` carries a value,
// and a date-window operator targets an actual date field. Dropping the rest
// stops a model's malformed filter/metric (e.g. countWhere on a field with no
// value, or `equals "thisMonth"`) from shipping as a dead or misleading control.
function predicateUsable(fieldId: string | undefined, operator: FilterOperator | undefined, value: string | undefined, fieldMap: Map<string, ProductField>, valueEnd?: string): boolean {
  if (!fieldId || !fieldMap.has(fieldId)) return false;
  // No operator means no real predicate — a countWhere/sumWhere without one would
  // silently default to "nonEmpty" and count/sum every record under a specific
  // label (the "Food this month" that was really an all-records total). Drop it.
  if (!operator || !(FILTER_OPERATORS as readonly string[]).includes(operator)) return false;
  const type = fieldMap.get(fieldId)?.type;
  if ((DATE_WINDOW_OPERATORS as readonly string[]).includes(operator)) {
    return type === "date" || type === "datetime";
  }
  // before/after only make sense against a date axis and need a comparison value.
  if ((DATE_COMPARISON_OPERATORS as readonly string[]).includes(operator)) {
    return (type === "date" || type === "datetime") && value !== undefined && value !== "";
  }
  // between needs both an inclusive low (value) and high (valueEnd) bound.
  if (operator === "between") return value !== undefined && value !== "" && valueEnd !== undefined && valueEnd !== "";
  // Every value-carrying operator needs a non-empty comparison value; the rest
  // (nonEmpty/empty/truthy/falsy) test presence and carry none.
  if (VALUE_OPERATORS.has(operator)) return value !== undefined && value !== "";
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

const normalizeOptionWord = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "");

// Pure calendar-position labels — where a record sits on the timeline relative to
// now. A status whose options are *only* these just re-labels the date axis, so it
// duplicates the date field and any date-window chips (Today ≈ "Happening today").
// Deliberately excludes lifecycle words (overdue, due soon, OK): an "Overdue / Due
// soon / fine" status carries real meaning the raw date does not, so it survives.
const CALENDAR_POSITION_WORDS = new Set([
  "today", "thisday", "tomorrow", "yesterday", "later", "earlier", "past",
  "future", "upcoming", "comingup", "thisweek", "nextweek", "lastweek",
  "thismonth", "nextmonth", "lastmonth", "thisyear", "soon", "now",
  "recent", "recently",
]);
// A hand-authored (non-derived) status re-bucketing a date is redundant across a
// broader vocabulary — including the overdue/due-soon words — because the guidance
// is to express those as a derived dateThreshold, not type them by hand.
const MANUAL_TIME_BUCKET_WORDS = new Set([...CALENDAR_POSITION_WORDS, "overdue", "duesoon", "duetoday", "due"]);

const allOptionsIn = (field: ProductField, vocabulary: Set<string>): boolean => {
  const options = field.options ?? [];
  return options.length >= 2 && options.every((option) => vocabulary.has(normalizeOptionWord(option)));
};

// Drop a status/category field that merely re-buckets an existing date axis — it
// only clutters the facet bar with overlapping, mostly-zero time chips. Two cases,
// only when the entity actually has a date/datetime to fall back on:
//   • a hand-authored status/category whose options are all time buckets, and
//   • a derived dateThreshold status whose options are all *calendar-position*
//     words (a genuine overdue/due-soon lifecycle keeps its meaning and stays).
// Filters/charts/actions that referenced the dropped field are pruned downstream
// by the existing validity checks (predicateUsable et al.).
function pruneRedundantTimeBucketFields(fields: ProductField[]): ProductField[] {
  const hasDate = fields.some((field) => field.type === "date" || field.type === "datetime");
  if (!hasDate) return fields;
  return fields.filter((field) => {
    if (field.type !== "status" && field.type !== "category") return true;
    if (!field.derive) return !allOptionsIn(field, MANUAL_TIME_BUCKET_WORDS);
    if (field.derive.kind === "dateThreshold") return !allOptionsIn(field, CALENDAR_POSITION_WORDS);
    return true;
  });
}

const TEMPORAL_STATUS_PATTERN = /^(?=.*(?:automatically|auto-set|set its status))(?=.*\bstart)(?=.*\bend)(?=.*\bstatus).+$/iu;

function inferRangeStatus(entity: ProductEntity, prose: string): ProductEntity {
  if (!TEMPORAL_STATUS_PATTERN.test(prose)) return entity;
  const semantic = (field: ProductField): string => `${field.id} ${field.label}`.toLowerCase();
  const start = entity.fields.find((field) => (field.type === "date" || field.type === "datetime") && /(^|\W)(start|begin|pickup|check[ -]?in)(\W|$)/u.test(semantic(field)));
  const end = entity.fields.find((field) => (field.type === "date" || field.type === "datetime") && /(^|\W)(end|due|dropoff|check[ -]?out)(\W|$)/u.test(semantic(field)));
  const completedField = entity.fields.find((field) => field.id !== end?.id && (field.type === "date" || field.type === "datetime") && /(^|\W)(return|completed|finished|closed)(\W|$)/u.test(semantic(field)));
  const status = entity.fields.find((field) => field.type === "status" && (field.options?.length ?? 0) >= 2);
  const option = (words: string[]) => status?.options?.find((candidate) => words.includes(candidate.trim().toLowerCase()));
  const upcoming = option(["reserved", "scheduled", "upcoming", "booked", "pending"]);
  const active = option(["out", "active", "rented", "checked out", "in progress", "ongoing"]);
  const completed = option(["returned", "completed", "complete", "finished", "closed"]);
  if (!start || !end || !status || !upcoming || !active || (completedField && !completed)) return entity;
  return {
    ...entity,
    fields: entity.fields.map((field) => field === status ? {
      ...field,
      derive: {
        kind: "rangeStatus",
        startField: start.id,
        endField: end.id,
        ...(completedField ? { completedField: completedField.id } : {}),
        buckets: { upcoming, active, past: active, ...(completed ? { completed } : {}) },
      },
    } : field),
  };
}

// A timeline-derived status cannot also be typed manually. When its lifecycle
// includes a cancelled/voided state, give that state a real boolean input and
// make it an explicit override. This also repairs otherwise-good model IR that
// lists "Cancelled" as an option/filter but cannot ever produce that value.
function ensureRangeStatusInactive(entity: ProductEntity): ProductEntity {
  const status = entity.fields.find((field) => field.derive?.kind === "rangeStatus");
  if (!status || status.derive?.kind !== "rangeStatus") return entity;
  const inactive = status.options?.find((candidate) => ["cancelled", "canceled", "voided", "inactive"].includes(candidate.trim().toLowerCase()));
  if (!inactive) return entity;

  const derive = status.derive;
  const existingOverride = derive.inactiveField
    ? entity.fields.find((field) => field.id === derive.inactiveField)
    : entity.fields.find((field) => field.type === "boolean" && /(^|\W)(cancel|void|inactive)(\W|$)/iu.test(`${field.id} ${field.label}`));
  const occupied = new Set(entity.fields.map((field) => identifier(field.id, "")));
  let override = existingOverride;
  if (!override) {
    let id = "cancelled";
    let suffix = 2;
    while (occupied.has(id)) id = `cancelled_${suffix++}`;
    override = { id, label: inactive, type: "boolean", required: false };
  }

  const fields = existingOverride ? entity.fields : [...entity.fields, override];
  return {
    ...entity,
    fields: fields.map((field) => field.id === status.id ? {
      ...field,
      derive: {
        ...derive,
        inactiveField: override.id,
        buckets: { ...derive.buckets, inactive },
      },
    } : field),
  };
}

// Preserve unmistakable novel browser interactions even when the interpretation
// model describes them in the product prose but forgets to repeat them in
// customRequirements. These signals name reusable interaction classes, not
// benchmark domains, and deliberately require multiple independent clues so an
// ordinary dashboard or an entity whose noun is "record" stays deterministic.
const INTERACTIVE_GRAPH_SIGNAL = /(?=.*\b(?:graph|network|canvas|dependency map)\b)(?=.*\b(?:drag(?:gable|ging)?|rearrang(?:e|ing)|connect(?:ing)?|arrows?|edges?|nodes?)\b)/isu;
const AUDIO_CAPTURE_SIGNAL = /(?=.*\b(?:audio|microphone|mediarecorder|voice memo|sound recording)\b)(?=.*\b(?:record(?:ing)?|capture|playback|play back|waveform|listen)\b)/isu;
const GRAPH_REQUIREMENT_COVERAGE = /\b(?:graph|network|canvas|nodes?|edges?)\b/iu;
const AUDIO_REQUIREMENT_COVERAGE = /\b(?:audio|microphone|mediarecorder|waveform|playback|voice memo)\b/iu;

function inferNovelCustomRequirements(input: ProductIR): string[] {
  const requirements = uniqueStrings(input.customRequirements ?? []);
  const prose = [
    input.product?.description ?? "",
    ...(input.assumptions ?? []),
  ].join(" ");
  const explicit = requirements.join(" ");
  if (INTERACTIVE_GRAPH_SIGNAL.test(prose) && !GRAPH_REQUIREMENT_COVERAGE.test(explicit)) {
    requirements.push("Render the described interactive node-and-edge graph with draggable persisted positions and editable relationships.");
  }
  if (AUDIO_CAPTURE_SIGNAL.test(prose) && !AUDIO_REQUIREMENT_COVERAGE.test(explicit)) {
    requirements.push("Support the described in-browser audio capture, playback, and waveform interaction with persisted recordings.");
  }
  return requirements;
}

export function normalizeProductIR(input: ProductIR): NormalizedProductIR {
  const inferredCustomRequirements = inferNovelCustomRequirements(input);
  const requirementProse = (input.customRequirements ?? []).join(" ");
  const entities = input.entities.map((entity, index) => {
    const prepared = ensureRangeStatusInactive(inferRangeStatus(entity, requirementProse));
    const fields = pruneRedundantTimeBucketFields(normalizeFields(prepared));
    // A derived field is computed, never entered, so it can never identify a record.
    const enterable = fields.filter((field) => !field.derive);
    // A date/datetime makes a poor record title: it renders formatted (e.g.
    // "Aug 17, 2026"), so its raw stored value never appears verbatim, and it
    // rarely identifies the record. Prefer a non-date enterable field for the
    // primary when one exists; fall back to a date only when nothing else can.
    // A reference field stores an opaque record id, so like a date it never makes
    // a readable title; keep it out of the preferred primary pool.
    const titleable = enterable.filter((field) => field.type !== "date" && field.type !== "datetime" && field.type !== "reference");
    const pool = titleable.length > 0 ? titleable : enterable;
    const fallbackPrimary = pool[0]?.id ?? enterable[0]?.id ?? fields[0]?.id ?? "name";
    const requestedPrimary = identifier(entity.primaryField, fallbackPrimary);
    const primaryField = pool.some((field) => field.id === requestedPrimary) ? requestedPrimary : fallbackPrimary;
    // The primary field identifies the record, so it is always required — this also
    // guarantees at least one required field for the validation journey.
    const requiredFields = fields.map((field) => field.id === primaryField ? { ...field, required: true } : field);
    return {
      name: clean(entity.name) || `item ${index + 1}`,
      plural: clean(String(entity.plural ?? "")) || `${clean(entity.name)}s`,
      primaryField,
      fields: requiredFields,
    };
  }) as [ProductEntity, ...ProductEntity[]];
  // Resolve reference fields now that every entity is known. A reference is kept
  // only when its refEntity resolves to a real, *different* entity (self-references
  // and dangling targets are meaningless); otherwise the field degrades to plain
  // text so a mis-specified link never blocks the compile. The stored refEntity is
  // rewritten to the target's canonical (cleaned) name so the runtime can match it.
  const entityByIdentifier = new Map(entities.map((entity) => [identifier(entity.name, ""), entity.name]));
  for (const entity of entities) {
    entity.fields = entity.fields.map((field) => {
      if (field.type !== "reference") return field;
      const target = field.refEntity ? entityByIdentifier.get(identifier(field.refEntity, "")) : undefined;
      if (!target || target === entity.name) {
        const { refEntity, ...rest } = field;
        return { ...rest, type: "text" };
      }
      return { ...field, refEntity: target };
    });
  }
  const primaryFieldMap = new Map(entities[0].fields.map((field) => [field.id, field]));
  const primaryFields = new Set(primaryFieldMap.keys());
  // A category/status field with a small fixed option set is, by construction, a
  // facet you can filter, group, and summarize by — that is the whole point of
  // enumerating its options. So a facet deterministically implies filter, group,
  // and calculate, even when the model under-scoped the idea and left them off
  // (which stranded the option list with no way to browse or break down by it).
  const hasFacet = Boolean(primaryFacetField(entities[0].fields));
  const hasExplicitFilters = (input.filters?.length ?? 0) > 0;
  const hasExplicitCalculations = (input.calculations?.length ?? 0) > 0;
  // Missing capabilities default to a sensible CRUD set rather than rejecting the IR;
  // an explicit false is preserved (?? only fills null/undefined) unless a facet forces it on.
  const capabilities = {
    create: input.capabilities?.create ?? true,
    edit: input.capabilities?.edit ?? true,
    delete: input.capabilities?.delete ?? true,
    search: input.capabilities?.search ?? true,
    filter: (input.capabilities?.filter ?? hasExplicitFilters) || hasFacet,
    sort: input.capabilities?.sort ?? true,
    group: (input.capabilities?.group ?? false) || hasFacet,
    transition: input.capabilities?.transition ?? false,
    calculate: (input.capabilities?.calculate ?? hasExplicitCalculations) || hasFacet,
    // Off by default: export/import is a real feature, not baseline CRUD, so it
    // appears only when the idea actually asks to export, back up, or download data.
    export: input.capabilities?.export ?? false,
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
      if ((type === "date" || type === "datetime") && filter.operator === "today" && /future|upcoming|later/iu.test(`${filter.id} ${filter.label}`)) {
        return { ...base, operator: "after" as const, value: "today" };
      }
      // Repair a model that expressed a date window as a fake value (equals
      // "thisMonth") into the real window operator so it actually filters.
      const asWindow = windowKeyword(filter.value);
      if (asWindow && (type === "date" || type === "datetime")) return { ...base, operator: asWindow };
      // "Currently active" is a positive state, not every state except one
      // terminal value. Repair the common model shorthand `notEquals Returned`
      // when the lifecycle has an explicit active option such as Out.
      const active = filter.operator === "notEquals" ? impliedActiveStatus(primaryFieldMap.get(field), `${filter.id} ${filter.label}`) : undefined;
      if (active) return { ...base, operator: "equals" as const, value: active };
      return { ...base, operator: filter.operator, ...(filter.value !== undefined ? { value: filter.value } : {}), ...(filter.valueEnd !== undefined ? { valueEnd: filter.valueEnd } : {}) };
    })
    .filter((filter) => predicateUsable(filter.field, filter.operator, filter.value, primaryFieldMap, filter.valueEnd));
  let calculations = (input.calculations ?? [])
    .map((calculation, index): ProductCalculation => {
      const id = identifier(calculation.id, `metric_${index + 1}`);
      const label = clean(calculation.label);
      const explicitEntity = calculation.entity ? identifier(calculation.entity, "") : "";
      const searchableName = identifier(`${id} ${label}`, "");
      // Weak models often write "Total matches" without an entity property.
      // In a multi-entity IR, infer scope only when the metric's id/label names
      // one entity; single-entity artifacts remain byte-stable.
      const inferredEntity = entities.length > 1
        ? entities.find((entity) => searchableName.includes(identifier(entity.plural, "")) || searchableName.includes(identifier(entity.name, "")))?.name
        : undefined;
      const entity = entities.some((candidate) => candidate.name === explicitEntity) ? explicitEntity : inferredEntity;
      const field = calculation.field ? identifier(calculation.field, "") : "";
      const active = calculation.operator === "notEquals" ? impliedActiveStatus(primaryFieldMap.get(field), `${id} ${label}`) : undefined;
      const normalized: ProductCalculation = {
        ...calculation,
        id,
        label,
        ...(entity ? { entity } : {}),
        ...(field ? { field } : {}),
        ...(calculation.sumField ? { sumField: identifier(calculation.sumField, "") } : {}),
      };
      if (!active) return normalized;
      const { valueEnd: _unusedValueEnd, ...withoutUpperBound } = normalized;
      return { ...withoutUpperBound, operator: "equals", value: active };
    })
    .filter((calculation) => {
      if (calculation.operation === "count") return true;
      // A bare aggregate (sum/average/min/max) totals or reduces one numeric field.
      if (calculation.operation === "sum" || calculation.operation === "average" || calculation.operation === "min" || calculation.operation === "max") return isNumeric(calculation.field);
      // A conditional aggregate reduces sumField over records matching the predicate.
      if (calculation.operation === "sumWhere" || calculation.operation === "avgWhere" || calculation.operation === "minWhere" || calculation.operation === "maxWhere") return isNumeric(calculation.sumField) && predicateUsable(calculation.field, calculation.operator, calculation.value, primaryFieldMap, calculation.valueEnd);
      // countWhere: a genuine predicate over a real field, never a bare no-value count.
      return predicateUsable(calculation.field, calculation.operator, calculation.value, primaryFieldMap, calculation.valueEnd);
    });
  if (capabilities.filter) filters = deriveOptionFilters(entities[0].fields, filters);
  filters = dedupeFiltersByLabel(filters);
  if (capabilities.calculate) calculations = deriveOptionCalculations(entities[0].fields, calculations);
  calculations = dedupeCalculationsByLabel(calculations, entities[0].name);
  // A chart is kept only when its axes resolve to fields of the right type for its
  // kind — line needs a date x and a numeric y; bar/pie need a category/status x and
  // may carry an optional numeric measure (dropped to a count when absent/invalid).
  // Anything else is dropped rather than rejected, so a mis-specified chart never
  // blocks a compile. An unknown type defaults to line.
  const charts = (input.charts ?? [])
    .map((chart, index): ProductChart => {
      const type = (CHART_TYPES as readonly string[]).includes(String(chart?.type)) ? (chart!.type as ChartType) : "line";
      const yField = identifier(String(chart?.yField ?? ""), "");
      const yType = primaryFieldMap.get(yField)?.type;
      const yNumeric = yType === "number" || yType === "currency";
      return {
        id: identifier(String(chart?.id ?? ""), `chart_${index + 1}`),
        label: clean(String(chart?.label ?? "")) || "Trend",
        type,
        xField: identifier(String(chart?.xField ?? ""), ""),
        // line requires a numeric y; bar/pie keep a numeric measure only when valid.
        ...(type === "line" ? { yField } : yNumeric ? { yField } : {}),
      };
    })
    .filter((chart) => {
      const xType = primaryFieldMap.get(chart.xField)?.type;
      if (chart.type === "line") {
        const yType = chart.yField ? primaryFieldMap.get(chart.yField)?.type : undefined;
        return (xType === "date" || xType === "datetime") && (yType === "number" || yType === "currency");
      }
      // bar/pie group on a fixed-option facet; without options there is nothing to bucket.
      const xField = primaryFieldMap.get(chart.xField);
      return (xType === "category" || xType === "status") && (xField?.options?.length ?? 0) > 0;
    });
  // A quick action mutates one stored field, so it is kept only when the field
  // exists, is enterable (never a derived field), and the verb matches the field's
  // type — a date stamp needs a date field, an increment a numeric one, a toggle a
  // boolean, a setValue a choice field with a value. Anything else is dropped
  // rather than rejected, so a mis-specified action never blocks a compile.
  const quickActions = (input.quickActions ?? [])
    .map((action, index): ProductQuickAction => {
      const set = (QUICK_ACTION_SETS as readonly string[]).includes(String(action?.set)) ? (action!.set as ProductQuickAction["set"]) : "today";
      const amount = Number(action?.amount);
      const value = clean(String(action?.value ?? ""));
      return {
        id: identifier(String(action?.id ?? ""), `action_${index + 1}`),
        label: clean(String(action?.label ?? "")) || "Update",
        field: identifier(String(action?.field ?? ""), ""),
        set,
        ...(set === "increment" ? { amount: Number.isFinite(amount) && amount !== 0 ? amount : 1 } : {}),
        ...(set === "setValue" && value ? { value } : {}),
      };
    })
    .filter((action) => {
      const field = primaryFieldMap.get(action.field);
      if (!field || field.derive) return false;
      switch (action.set) {
        case "clear": return true;
        case "today": return field.type === "date" || field.type === "datetime";
        case "now": return field.type === "datetime";
        case "increment": return field.type === "number" || field.type === "currency";
        case "toggle": return field.type === "boolean";
        // setValue advances a choice field; require a target value, and — when the
        // field has a fixed option set (status, or a category without custom input) —
        // require the target to be one of those options.
        case "setValue": {
          if ((field.type !== "category" && field.type !== "status") || !action.value) return false;
          const fixed = field.type === "status" || field.allowCustom === false;
          return !fixed || (field.options ?? []).includes(action.value);
        }
        default: return false;
      }
    });
  // A priority is a deterministic ordering over the primary entity. Invalid
  // field references degrade to no priority rather than forcing a repair call.
  // Its optional filter uses the exact same predicate contract as filter chips.
  let priority: ProductPriority | undefined;
  if (input.priority) {
    const sortField = identifier(input.priority.sortField, "");
    const sortTarget = primaryFieldMap.get(sortField);
    if (sortTarget && !sortTarget.derive) {
      const rawFilter = input.priority.filter;
      const filterField = rawFilter ? identifier(rawFilter.field, "") : "";
      const filter = rawFilter && predicateUsable(filterField, rawFilter.operator, rawFilter.value, primaryFieldMap, rawFilter.valueEnd)
        ? { field: filterField, operator: rawFilter.operator, ...(rawFilter.value !== undefined ? { value: clean(rawFilter.value) } : {}), ...(rawFilter.valueEnd !== undefined ? { valueEnd: clean(rawFilter.valueEnd) } : {}) }
        : undefined;
      priority = {
        label: clean(input.priority.label ?? "") || "Next up",
        sortField,
        direction: input.priority.direction === "desc" ? "desc" : "asc",
        ...(filter ? { filter } : {}),
      };
    }
  }
  const entityMap = new Map(entities.map((entity) => [identifier(entity.name, ""), entity]));
  const rangeConflicts = normalizeRangeConflicts(input, entities);
  const standings = (input.standings ?? []).map((table, index): ProductStandings | undefined => {
    const rowEntity = identifier(String(table?.rowEntity ?? ""), "");
    const sourceEntity = identifier(String(table?.sourceEntity ?? ""), "");
    const rows = entityMap.get(rowEntity);
    const source = entityMap.get(sourceEntity);
    if (!rows || !source || rows === source || !Array.isArray(table?.participants) || table.participants.length !== 2) return undefined;
    const sourceFields = new Map(source.fields.map((field) => [field.id, field]));
    const participants = table.participants.map((participant) => ({
      entityField: identifier(String(participant.entityField ?? ""), ""),
      scoreForField: identifier(String(participant.scoreForField ?? ""), ""),
      scoreAgainstField: identifier(String(participant.scoreAgainstField ?? ""), ""),
    })) as ProductStandings["participants"];
    const valid = participants.every((participant) => {
      const entityField = sourceFields.get(participant.entityField);
      const forField = sourceFields.get(participant.scoreForField);
      const againstField = sourceFields.get(participant.scoreAgainstField);
      return Boolean(entityField && forField && againstField &&
        (forField.type === "number" || forField.type === "currency") &&
        (againstField.type === "number" || againstField.type === "currency"));
    });
    if (!valid) return undefined;
    const points = table.points ?? { win: 3, draw: 1, loss: 0 };
    return {
      id: identifier(String(table.id ?? ""), `standings_${index + 1}`),
      label: clean(String(table.label ?? "")) || "Standings",
      rowEntity,
      sourceEntity,
      participants,
      points: {
        win: Number.isFinite(points.win) ? points.win : 3,
        draw: Number.isFinite(points.draw) ? points.draw : 1,
        loss: Number.isFinite(points.loss) ? points.loss : 0,
      },
    };
  }).filter((table): table is ProductStandings => Boolean(table));
  const name = clean(input.product?.name ?? "") || "Untitled";
  // Exclude the raw input.priority from the passthrough spread: it is re-emitted
  // below only when it normalized to a usable value, so an unusable one is dropped
  // rather than leaked through `...input` untouched.
  const { priority: _rawPriority, rangeConflicts: _rawRangeConflicts, ...inputWithoutPriority } = input;
  return {
    ...inputWithoutPriority,
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
    charts,
    quickActions,
    rangeConflicts,
    standings,
    ...(priority ? { priority } : {}),
    persistence: { strategy: "localStorage" },
    assumptions: uniqueStrings(input.assumptions ?? []),
    excluded: uniqueStrings(input.excluded ?? []),
    // When the strict deterministic fallback recognized the full overlapping-
    // range invariant, do not route the same prose to bespoke model-authored code.
    customRequirements: inferredCustomRequirements.filter((requirement) => {
      if (rangeConflicts.length > 0 && RANGE_CONFLICT_PATTERN.test(requirement)) return false;
      if (entities.some((entity) => entity.fields.some((field) => field.derive?.kind === "rangeStatus")) && TEMPORAL_STATUS_PATTERN.test(requirement)) return false;
      return true;
    }),
  };
}
