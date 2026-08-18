import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClassifiedFailure } from "../qa/classify.js";

export interface RepairResult { applied: boolean; description: string; }

export async function deterministicRepair(appRoot: string, failure: ClassifiedFailure): Promise<RepairResult> {
  if (failure.category !== "configuration") return { applied: false, description: `No deterministic rule for ${failure.category}.` };
  const configPath = path.join(appRoot, "product.config.json");
  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const fields = Array.isArray(config.fields) ? config.fields as Array<Record<string, unknown>> : [];
    if (fields.length === 0) return { applied: false, description: "Configuration has no recoverable fields." };
    const fieldKeys = fields.map((field) => String(field.key));
    if (!fieldKeys.includes(String(config.primaryField))) config.primaryField = fieldKeys[0];
    config.secondaryFields = Array.isArray(config.secondaryFields)
      ? config.secondaryFields.filter((key) => fieldKeys.includes(String(key)))
      : fieldKeys.slice(1, 5);
    config.searchableFields = Array.isArray(config.searchableFields)
      ? config.searchableFields.filter((key) => fieldKeys.includes(String(key)))
      : fieldKeys;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return { applied: true, description: "Reconciled primary, secondary, and searchable fields with the compiled schema." };
  } catch {
    return { applied: false, description: "Configuration could not be parsed for repair." };
  }
}
