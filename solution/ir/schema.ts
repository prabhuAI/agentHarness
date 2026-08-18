import {
  CALCULATION_OPERATIONS,
  FIELD_TYPES,
  FILTER_OPERATORS,
  GENOMES,
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
    for (const key of ["name", "description", "tagline", "targetUser"] as const) {
      if (typeof product[key] !== "string" || product[key].trim() === "") issues.push(`product.${key} is required`);
    }
    if (!GENOMES.includes(product.genome as never)) issues.push("product.genome is unsupported");
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
      if (!FIELD_TYPES.includes(field.type as never)) issues.push(`field ${fieldIndex} has unsupported type`);
      if (typeof field.required !== "boolean") issues.push(`field ${fieldIndex}.required must be boolean`);
      if (field.options !== undefined && !strings(field.options)) issues.push(`field ${fieldIndex}.options must be strings`);
    });
  });

  if (!isRecord(value.capabilities)) issues.push("capabilities must be an object");
  else for (const key of ["create", "edit", "delete", "search", "filter", "sort", "group", "transition", "calculate"]) {
    if (typeof value.capabilities[key] !== "boolean") issues.push(`capabilities.${key} must be boolean`);
  }
  if (!Array.isArray(value.filters)) issues.push("filters must be an array");
  else value.filters.forEach((filter, index) => {
    if (!isRecord(filter) || typeof filter.id !== "string" || typeof filter.label !== "string" || typeof filter.field !== "string") issues.push(`filters[${index}] is invalid`);
    else if (!FILTER_OPERATORS.includes(filter.operator as never)) issues.push(`filters[${index}].operator is unsupported`);
  });
  if (!Array.isArray(value.calculations)) issues.push("calculations must be an array");
  else value.calculations.forEach((calculation, index) => {
    if (!isRecord(calculation) || typeof calculation.id !== "string" || typeof calculation.label !== "string") issues.push(`calculations[${index}] is invalid`);
    else if (!CALCULATION_OPERATIONS.includes(calculation.operation as never)) issues.push(`calculations[${index}].operation is unsupported`);
  });
  for (const key of ["assumptions", "excluded", "customRequirements"] as const) {
    if (!strings(value[key])) issues.push(`${key} must be an array of strings`);
  }
  if (!isRecord(value.persistence) || value.persistence.strategy !== "localStorage") {
    issues.push("persistence.strategy must be localStorage");
  }
  if (issues.length > 0) throw new ProductIRValidationError(issues);
  return value as unknown as ProductIR;
}
