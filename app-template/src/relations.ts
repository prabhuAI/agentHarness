import { type EntityConfig, type FieldConfig, productConfig } from "./product-config.js";
import { createRepository } from "./repository.js";

// The entity a reference field links to, or undefined when the field is not a
// resolvable reference. Resolution is by the canonical entity name the compiler
// wrote into `refEntity`.
export function referenceTarget(field: Pick<FieldConfig, "type" | "refEntity">): EntityConfig | undefined {
  if (field.type !== "reference" || !field.refEntity) return undefined;
  return (productConfig.entities ?? []).find((entity) => entity.name === field.refEntity);
}

// Repository name for an entity's store. The primary entity shares the product's
// own namespace; every other entity gets a per-entity namespace. This mirrors how
// App.tsx (createRepository(productConfig.name)) and RelatedWorkspace
// (createRepository(`${name}:${entity}`)) name their stores, so a reference
// resolves against the same records the owning view reads and writes.
export function repositoryNameFor(entityName: string): string {
  const primaryName = productConfig.entities?.[0]?.name ?? productConfig.entityName;
  return entityName === primaryName ? productConfig.name : `${productConfig.name}:${entityName}`;
}

// The pickable records of a reference target: its stored id plus the label from
// its primary field. Read synchronously from localStorage at call time.
export function referenceOptions(target: EntityConfig): Array<{ id: string; label: string }> {
  return createRepository(repositoryNameFor(target.name)).repository.list()
    .map((record) => ({ id: record.id, label: String(record.values[target.primaryField] ?? "Unnamed") }));
}

// Resolve a stored reference id to its target record's label. Returns an em dash
// for an empty link and a clear marker when the linked record no longer exists.
export function referenceLabel(target: EntityConfig, id: string): string {
  const raw = String(id ?? "").trim();
  if (!raw) return "—";
  const match = createRepository(repositoryNameFor(target.name)).repository.list().find((record) => record.id === raw);
  return match ? String(match.values[target.primaryField] ?? "Unnamed") : "Unknown record";
}
