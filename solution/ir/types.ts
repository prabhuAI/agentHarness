export const GENOMES = ["tracker", "workflow", "catalog", "planner", "dashboard"] as const;
export type Genome = (typeof GENOMES)[number];

export const FIELD_TYPES = [
  "text", "longText", "number", "currency", "date", "datetime", "boolean",
  "category", "status", "email", "url",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FILTER_OPERATORS = ["equals", "nonEmpty", "empty", "truthy", "falsy"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const CALCULATION_OPERATIONS = ["count", "countWhere", "sum"] as const;
export type CalculationOperation = (typeof CALCULATION_OPERATIONS)[number];

export interface ProductField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
  allowCustom?: boolean;
  min?: number;
  max?: number;
}

export interface ProductEntity {
  name: string;
  plural: string;
  primaryField: string;
  fields: ProductField[];
}

export interface ProductFilter {
  id: string;
  label: string;
  field: string;
  operator: FilterOperator;
  value?: string;
}

export interface ProductCalculation {
  id: string;
  label: string;
  operation: CalculationOperation;
  field?: string;
  operator?: FilterOperator;
  value?: string;
}

export interface ProductCapabilities {
  create: boolean;
  edit: boolean;
  delete: boolean;
  search: boolean;
  filter: boolean;
  sort: boolean;
  group: boolean;
  transition: boolean;
  calculate: boolean;
}

export interface ProductIR {
  version: "1";
  product: {
    name: string;
    description: string;
    tagline: string;
    targetUser: string;
    genome: Genome;
    accent?: string;
  };
  entities: ProductEntity[];
  capabilities: ProductCapabilities;
  filters: ProductFilter[];
  calculations: ProductCalculation[];
  persistence: { strategy: "localStorage" };
  assumptions: string[];
  excluded: string[];
  customRequirements: string[];
}

export interface NormalizedProductIR extends ProductIR {
  entities: [ProductEntity, ...ProductEntity[]];
}

export type BuildRoute = "compile" | "hybrid" | "custom";

export interface RouteDecision {
  route: BuildRoute;
  genome: Genome;
  supported: string[];
  unsupported: string[];
  reason: string;
}
