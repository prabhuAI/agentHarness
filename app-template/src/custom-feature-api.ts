import { productConfig } from "./product-config.js";
import { createRepository, type EntityRecord, type RecordValue, type Repository } from "./repository.js";

/**
 * Stable integration seam for an interaction that cannot be represented by
 * Product IR. The generic app owns CRUD and layout; this slot owns only the
 * focused custom workspace.
 */
export interface CustomFeatureProps {
  /** Current primary-entity records, including derived display values. */
  records: EntityRecord[];
  /** Reload the primary collection after the custom feature changes it. */
  onRecordsChanged: () => void;
  /** Highlight and scroll to a primary record in the generic collection. */
  onSelectRecord: (id: string) => void;
}

export { productConfig, createRepository };
export type { EntityRecord, RecordValue, Repository };

/** Open the repository used by the primary generic workspace. */
export function primaryRepository(): Repository {
  return createRepository(productConfig.name).repository;
}

/** Open a related entity repository using the generic runtime namespace. */
export function relatedRepository(entityName: string): Repository {
  return createRepository(`${productConfig.name}:${entityName}`).repository;
}

/** Persist focused custom interaction state without accessing localStorage in UI code. */
export function customStateRepository(featureName: string): Repository {
  return createRepository(`${productConfig.name}:custom:${featureName}`).repository;
}

/** Human-readable value for a primary record. */
export function primaryRecordLabel(record: EntityRecord): string {
  return String(record.values[productConfig.primaryField] ?? "Untitled");
}
