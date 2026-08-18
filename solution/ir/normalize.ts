import type { NormalizedProductIR, ProductEntity, ProductField, ProductIR } from "./types.js";

const clean = (value: string): string => value.trim().replace(/\s+/gu, " ");
const identifier = (value: string, fallback: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || fallback;
};
const uniqueStrings = (values: string[]): string[] => [...new Set(values.map(clean).filter(Boolean))];

function normalizeFields(entity: ProductEntity): ProductField[] {
  const seen = new Set<string>();
  return entity.fields.map((field, index) => {
    let id = identifier(field.id || field.label, `field_${index + 1}`);
    while (seen.has(id)) id = `${id}_${index + 1}`;
    seen.add(id);
    const options = field.options ? uniqueStrings(field.options) : undefined;
    return {
      id,
      label: clean(field.label || id),
      type: field.type,
      required: Boolean(field.required),
      ...(field.placeholder ? { placeholder: clean(field.placeholder) } : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(field.allowCustom !== undefined ? { allowCustom: field.allowCustom } : {}),
      ...(Number.isFinite(field.min) ? { min: field.min } : {}),
      ...(Number.isFinite(field.max) ? { max: field.max } : {}),
    };
  });
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
  const filters = input.filters
    .map((filter, index) => ({ ...filter, id: identifier(filter.id, `filter_${index + 1}`), label: clean(filter.label), field: identifier(filter.field, "") }))
    .filter((filter) => primaryFields.has(filter.field) && (filter.operator !== "equals" || filter.value !== undefined));
  const calculations = input.calculations
    .map((calculation, index) => ({ ...calculation, id: identifier(calculation.id, `metric_${index + 1}`), label: clean(calculation.label), ...(calculation.field ? { field: identifier(calculation.field, "") } : {}) }))
    .filter((calculation) => {
      if (calculation.operation === "count") return true;
      if (!calculation.field || !primaryFields.has(calculation.field)) return false;
      if (calculation.operation !== "sum") return true;
      const type = primaryFieldMap.get(calculation.field)?.type;
      return type === "number" || type === "currency";
    });
  return {
    ...input,
    version: "1",
    product: {
      ...input.product,
      name: clean(input.product.name),
      description: clean(input.product.description),
      tagline: clean(input.product.tagline),
      targetUser: clean(input.product.targetUser),
      accent: /^#[0-9a-f]{6}$/iu.test(input.product.accent ?? "") ? input.product.accent! : "#5b5bd6",
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
