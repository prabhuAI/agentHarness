import { productConfig } from "./product-config.js";
import { type EntityRecord, type RecordValue } from "./repository.js";

// The primary entity's fields, in display order (primary first). Export and import
// operate over exactly these — derived (computed) fields are excluded because they
// are never stored or entered.
const ioFields = () => productConfig.fields.filter((field) => !field.derive);

// Serialize records for a JSON export/import: an array of plain value objects over
// the enterable fields. Round-trips cleanly back through parseImportedRecords.
export function recordsToJson(records: ReadonlyArray<EntityRecord>): string {
  const keys = ioFields().map((field) => field.key);
  const shaped = records.map((record) => Object.fromEntries(keys.map((key) => [key, record.values[key] ?? ""])));
  return JSON.stringify(shaped, null, 2);
}

// RFC-4180 CSV quoting: wrap in quotes and double any embedded quotes when the
// value contains a comma, quote, or newline.
const csvCell = (value: unknown): string => {
  const text = String(value ?? "");
  return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
};

// Serialize records to CSV with a header row of field labels, one column per
// enterable field in display order.
export function recordsToCsv(records: ReadonlyArray<EntityRecord>): string {
  const fields = ioFields();
  const header = fields.map((field) => csvCell(field.label)).join(",");
  const rows = records.map((record) => fields.map((field) => csvCell(record.values[field.key])).join(","));
  return [header, ...rows].join("\n");
}

// Parse imported JSON into value objects ready for repository.create. Accepts both
// the plain-value-object shape and full {values} records; keeps only configured
// enterable fields with primitive values, so foreign or malformed keys are dropped
// rather than trusted. Throws on non-array input so the caller can surface an error.
export function parseImportedRecords(text: string): Array<Record<string, RecordValue>> {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Expected a JSON array of records.");
  const keys = new Set(ioFields().map((field) => field.key));
  return data
    .map((entry) => {
      const source = entry && typeof entry === "object" && "values" in (entry as object)
        ? (entry as { values?: unknown }).values
        : entry;
      const values = source && typeof source === "object" ? source as Record<string, unknown> : {};
      const cleaned: Record<string, RecordValue> = {};
      for (const [key, value] of Object.entries(values)) {
        if (keys.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) cleaned[key] = value;
      }
      return cleaned;
    })
    .filter((values) => Object.keys(values).length > 0);
}
