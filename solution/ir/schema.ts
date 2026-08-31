import {
  CALCULATION_OPERATIONS,
  DESIGN_CONTRASTS,
  DESIGN_DENSITIES,
  DESIGN_MOTIONS,
  DESIGN_TONES,
  FILTER_OPERATORS,
  QUICK_ACTION_SETS,
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
      // A malformed visibleWhen is not fatal: normalizeProductIR drops a condition
      // with a missing/empty/dangling field or equals, so the field just stays
      // always-visible. Reject only a present-but-mistyped value — never a missing
      // part — so an incomplete condition degrades instead of forcing a repair call.
      if (field.visibleWhen !== undefined) {
        if (!isRecord(field.visibleWhen)) issues.push(`field ${fieldIndex}.visibleWhen must be an object`);
        else {
          if (field.visibleWhen.field !== undefined && typeof field.visibleWhen.field !== "string") issues.push(`field ${fieldIndex}.visibleWhen.field must be a string`);
          if (field.visibleWhen.equals !== undefined && typeof field.visibleWhen.equals !== "string") issues.push(`field ${fieldIndex}.visibleWhen.equals must be a string`);
        }
      }
      // A malformed derive spec is not fatal: normalizeProductIR deterministically
      // drops any unusable derive (unknown kind, missing expression/sourceField/
      // dateField, dangling refs, missing buckets) so the field degrades to a plain
      // manual field. Hard-failing here instead forces a wasteful repair model call
      // for something we already fix in code, so validate rejects ONLY a value that
      // is PRESENT but of the wrong type — never a missing required part, and never
      // an unsupported kind (both of which normalize drops).
      if (field.derive !== undefined) {
        if (!isRecord(field.derive)) issues.push(`field ${fieldIndex}.derive must be an object`);
        else {
          const derive = field.derive;
          const mistyped = (value: unknown): boolean => value !== undefined && typeof value !== "string";
          if (derive.kind === "formula") {
            if (mistyped(derive.expression)) issues.push(`field ${fieldIndex}.derive.expression must be a string`);
          } else if (derive.kind === "presence") {
            if (mistyped(derive.sourceField)) issues.push(`field ${fieldIndex}.derive.sourceField must be a string`);
            for (const label of ["whenPresent", "whenEmpty"] as const) {
              if (mistyped(derive[label])) issues.push(`field ${fieldIndex}.derive.${label} must be a string`);
            }
          } else if (derive.kind === "dateThreshold") {
            if (mistyped(derive.dateField)) issues.push(`field ${fieldIndex}.derive.dateField must be a string`);
            if (derive.buckets !== undefined && !isRecord(derive.buckets)) issues.push(`field ${fieldIndex}.derive.buckets must be an object`);
            else if (isRecord(derive.buckets)) {
              for (const band of ["overdue", "soon", "ok"] as const) {
                if (mistyped(derive.buckets[band])) issues.push(`field ${fieldIndex}.derive.buckets.${band} must be a string`);
              }
            }
          }
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
    else if (calculation.sumField !== undefined && typeof calculation.sumField !== "string") issues.push(`calculations[${index}].sumField must be a string`);
    else if (calculation.entity !== undefined && typeof calculation.entity !== "string") issues.push(`calculations[${index}].entity must be a string`);
  });
  // A malformed chart is not fatal: normalizeProductIR drops any chart whose
  // axes do not resolve to a date and a numeric field, so validate only rejects
  // a charts value of the wrong top-level type.
  if (value.charts !== undefined && !Array.isArray(value.charts)) issues.push("charts must be an array");
  // quickActions are recoverable: normalizeProductIR drops any whose field is
  // missing or whose set/field-type combination is invalid, so validate only
  // rejects a quickActions value of the wrong top-level type or a mistyped entry.
  if (value.quickActions !== undefined && !Array.isArray(value.quickActions)) issues.push("quickActions must be an array");
  else if (Array.isArray(value.quickActions)) value.quickActions.forEach((action, index) => {
    if (!isRecord(action) || typeof action.id !== "string" || typeof action.label !== "string" || typeof action.field !== "string") issues.push(`quickActions[${index}] is invalid`);
    else if (!(QUICK_ACTION_SETS as readonly string[]).includes(String(action.set))) issues.push(`quickActions[${index}].set must be one of ${QUICK_ACTION_SETS.join(", ")}`);
  });
  if (value.standings !== undefined && !Array.isArray(value.standings)) issues.push("standings must be an array");
  else if (Array.isArray(value.standings)) value.standings.forEach((table, index) => {
    if (!isRecord(table) || typeof table.id !== "string" || typeof table.label !== "string" ||
      typeof table.rowEntity !== "string" || typeof table.sourceEntity !== "string") {
      issues.push(`standings[${index}] is invalid`);
      return;
    }
    if (!Array.isArray(table.participants) || table.participants.length !== 2) issues.push(`standings[${index}].participants must contain exactly two sides`);
    else table.participants.forEach((participant, participantIndex) => {
      if (!isRecord(participant) || typeof participant.entityField !== "string" ||
        typeof participant.scoreForField !== "string" || typeof participant.scoreAgainstField !== "string") {
        issues.push(`standings[${index}].participants[${participantIndex}] is invalid`);
      }
    });
    if (table.points !== undefined && (!isRecord(table.points) ||
      ![table.points.win, table.points.draw, table.points.loss].every((point) => typeof point === "number" && Number.isFinite(point)))) {
      issues.push(`standings[${index}].points is invalid`);
    }
  });
  if (value.priority !== undefined && !isRecord(value.priority)) issues.push("priority must be an object");
  else if (isRecord(value.priority)) {
    // priority is a soft ordering enhancement. An incomplete one (no usable
    // sortField) is not a correctness error: normalizeProductIR deterministically
    // drops a priority whose sortField is missing or unresolvable rather than
    // forcing a repair call, so a missing sortField here must degrade the same
    // way — not hard-fail the whole IR. Its other fields are still validated only
    // when the priority is well-formed enough to survive normalization.
    if (typeof value.priority.sortField === "string" && value.priority.sortField.trim() !== "") {
      if (value.priority.label !== undefined && typeof value.priority.label !== "string") issues.push("priority.label must be a string");
      if (value.priority.direction !== undefined && value.priority.direction !== "asc" && value.priority.direction !== "desc") issues.push("priority.direction must be asc or desc");
      if (value.priority.filter !== undefined && !isRecord(value.priority.filter)) issues.push("priority.filter must be an object");
    }
  }
  for (const key of ["assumptions", "excluded", "customRequirements"] as const) {
    if (value[key] !== undefined && !strings(value[key])) issues.push(`${key} must be an array of strings`);
  }
  if (value.persistence !== undefined && (!isRecord(value.persistence) || value.persistence.strategy !== "localStorage")) {
    issues.push("persistence.strategy must be localStorage");
  }
  if (issues.length > 0) throw new ProductIRValidationError(issues);
  return value as unknown as ProductIR;
}
