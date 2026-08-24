import type { NormalizedProductIR } from "../ir/types.js";

export interface DerivedJourney {
  id: string;
  description: string;
}

export function deriveJourneys(ir: NormalizedProductIR): DerivedJourney[] {
  const entity = ir.entities[0];
  const journeys: DerivedJourney[] = [
    { id: "load", description: "Application loads and shows a useful empty state" },
  ];
  if (ir.capabilities.create) journeys.push(
    { id: "validation", description: `Invalid ${entity.name} input shows validation without crashing` },
    { id: "create", description: `User can add a complete ${entity.name} and see it in ${entity.plural}` },
  );
  journeys.push({ id: "persistence", description: `${entity.plural} survive a page refresh` });
  if (ir.capabilities.edit) journeys.push({ id: "edit", description: `User can edit an existing ${entity.name}` });
  if (ir.capabilities.search) journeys.push({ id: "search", description: `User can search ${entity.plural}` });
  if (ir.capabilities.filter && ir.filters.length > 0) journeys.push({ id: "filter", description: `User can narrow ${entity.plural} with a meaningful filter` });
  if (ir.capabilities.group && entity.fields.some((field) => field.type === "category" || field.type === "status")) journeys.push({ id: "group", description: `${entity.plural} are grouped by a meaningful category or status` });
  if (ir.capabilities.calculate && ir.calculations.length > 0) journeys.push({ id: "calculate", description: "Requested derived values update from persisted records" });
  if (ir.capabilities.delete) journeys.push({ id: "delete", description: `User can delete an existing ${entity.name}` });
  if (ir.quickActions.length > 0) journeys.push({ id: "quick_action", description: `A one-tap action updates a ${entity.name} field and persists` });
  if (ir.entities.length > 1) journeys.push({ id: "related_entities", description: `User can add, edit, and persist records for all ${ir.entities.length} related entities` });
  if (ir.standings.length > 0) journeys.push({ id: "standings", description: "Standings recalculate from scored records and rank participants by points and score difference" });
  return journeys;
}
