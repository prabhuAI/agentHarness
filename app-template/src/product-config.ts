import rawConfig from "../product.config.json";

export type FieldType =
  | "text" | "longText" | "number" | "currency" | "date" | "datetime"
  | "boolean" | "category" | "status" | "email" | "url";
export type PredicateOperator = "equals" | "nonEmpty" | "empty" | "truthy" | "falsy";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  allowCustom?: boolean;
  min?: number;
  max?: number;
}

export interface FilterPreset {
  id: string;
  label: string;
  field: string;
  operator: PredicateOperator;
  value?: string;
}

export interface SummaryConfig {
  id: string;
  label: string;
  operation: "count" | "countWhere" | "sum";
  field?: string;
  operator?: PredicateOperator;
  value?: string;
}

export interface ProductConfig {
  name: string;
  tagline: string;
  entityName: string;
  entityNamePlural: string;
  genome: "tracker" | "workflow" | "catalog" | "planner" | "dashboard";
  eyebrow: string;
  collectionLabel: string;
  accent: string;
  fields: FieldConfig[];
  primaryField: string;
  secondaryFields: string[];
  searchableFields: string[];
  filters: FilterPreset[];
  summaries: SummaryConfig[];
  capabilities: { create: boolean; edit: boolean; delete: boolean; search: boolean; sort: boolean; group: boolean };
}

export const productConfig = rawConfig as ProductConfig;
