import {
  CALCULATION_OPERATIONS,
  DESIGN_CONTRASTS,
  DESIGN_DENSITIES,
  DESIGN_MOTIONS,
  DESIGN_TONES,
  FILTER_OPERATORS,
  type ProductIR,
} from "./types.js";

export class ProductIRValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid Product IR: ${issues.join("; ")}`);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export function validateProductIR(value: unknown): ProductIR {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ProductIRValidationError(["root must be an object"]);
  if (value.version !== "1") issues.push("version must be 1");
  const product = value.product;
  if (!isRecord(product)) issues.push("product must be an object");
  else {
    if (typeof product.name !== "string" || product.name.trim() === "") issues.push("product.name is required");
    // description, targetUser, genome, and tagline are recoverable: normalizeProductIR
    // fills sensible defaults (name, "A single user", tracker) rather than rejecting.
    for (const key of ["description", "targetUser", "tagline"] as const) {
      if (product[key] !== undefined && typeof product[key] !== "string") issues.push(`product.${key} must be a string`);
    }
    if (product.design !== undefined) {
      if (!isRecord(product.design)) issues.push("product.design must be an object");
      else {
        if (!DESIGN_TONES.includes(product.design.tone as never)) issues.push("product.design.tone is unsupported");
        if (!DESIGN_DENSITIES.includes(product.design.density as never)) issues.push("product.design.density is unsupported");
        if (!DESIGN_CONTRASTS.includes(product.design.contrast as never)) issues.push("product.design.contrast is unsupported");
        if (!DESIGN_MOTIONS.includes(product.design.motion as never)) issues.push("product.design.motion is unsupported");
      }
    }
  }

  if (!Array.isArray(value.entities) || value.entities.length === 0) issues.push("at least one entity is required");
  else value.entities.forEach((entity, entityIndex) => {
    if (!isRecord(entity)) { issues.push(`entities[${entityIndex}] must be an object`); return; }
    if (typeof entity.name !== "string" || entity.name.trim() === "") issues.push(`entities[${entityIndex}].name is required`);
    if (typeof entity.plural !== "string" || entity.plural.trim() === "") issues.push(`entities[${entityIndex}].plural is required`);
    if (!Array.isArray(entity.fields) || entity.fields.length === 0) issues.push(`entities[${entityIndex}] needs fields`);
    else entity.fields.forEach((field, fieldIndex) => {
      if (!isRecord(field)) { issues.push(`entities[${entityIndex}].fields[${fieldIndex}] must be an object`); return; }
      if (typeof field.id !== "string" || field.id.trim() === "") issues.push(`field ${fieldIndex} needs an id`);
      if (typeof field.label !== "string" || field.label.trim() === "") issues.push(`field ${fieldIndex} needs a label`);
      // The type string is coerced downstream (normalizeProductIR maps synonyms like
      // "select" to the runtime vocabulary), so require only a non-empty string here
      // rather than rejecting the whole IR over one mislabeled type.
      if (typeof field.type !== "string" || field.type.trim() === "") issues.push(`field ${fieldIndex} needs a type`);
      if (field.required !== undefined && typeof field.required !== "boolean") issues.push(`field ${fieldIndex}.required must be boolean`);
      if (field.options !== undefined && !strings(field.options)) issues.push(`field ${fieldIndex}.options must be strings`);
      if (field.visibleWhen !== undefined) {
        if (!isRecord(field.visibleWhen)) issues.push(`field ${fieldIndex}.visibleWhen must be an object`);
        else {
          if (typeof field.visibleWhen.field !== "string" || field.visibleWhen.field.trim() === "") issues.push(`field ${fieldIndex}.visibleWhen.field is required`);
          if (typeof field.visibleWhen.equals !== "string" || field.visibleWhen.equals.trim() === "") issues.push(`field ${fieldIndex}.visibleWhen.equals is required`);
        }
      }
    });
  });

  // capabilities, filters, calculations, the phrase arrays, and persistence are all
  // recoverable: normalizeProductIR defaults them (CRUD set, empty arrays, localStorage),
  // so validate only rejects them when present with the wrong type.
  if (value.capabilities !== undefined && !isRecord(value.capabilities)) issues.push("capabilities must be an object");
  else if (isRecord(value.capabilities)) for (const key of ["create", "edit", "delete", "search", "filter", "sort", "group", "transition", "calculate"]) {
    if (value.capabilities[key] !== undefined && typeof value.capabilities[key] !== "boolean") issues.push(`capabilities.${key} must be boolean`);
  }
  if (value.filters !== undefined && !Array.isArray(value.filters)) issues.push("filters must be an array");
  else if (Array.isArray(value.filters)) value.filters.forEach((filter, index) => {
    if (!isRecord(filter) || typeof filter.id !== "string" || typeof filter.label !== "string" || typeof filter.field !== "string") issues.push(`filters[${index}] is invalid`);
    else if (!FILTER_OPERATORS.includes(filter.operator as never)) issues.push(`filters[${index}].operator is unsupported`);
  });
  if (value.calculations !== undefined && !Array.isArray(value.calculations)) issues.push("calculations must be an array");
  else if (Array.isArray(value.calculations)) value.calculations.forEach((calculation, index) => {
    if (!isRecord(calculation) || typeof calculation.id !== "string" || typeof calculation.label !== "string") issues.push(`calculations[${index}] is invalid`);
    else if (!CALCULATION_OPERATIONS.includes(calculation.operation as never)) issues.push(`calculations[${index}].operation is unsupported`);
  });
  for (const key of ["assumptions", "excluded", "customRequirements"] as const) {
    if (value[key] !== undefined && !strings(value[key])) issues.push(`${key} must be an array of strings`);
  }
  if (value.persistence !== undefined && (!isRecord(value.persistence) || value.persistence.strategy !== "localStorage")) {
    issues.push("persistence.strategy must be localStorage");
  }
  if (issues.length > 0) throw new ProductIRValidationError(issues);
  return value as unknown as ProductIR;
}
