import type { RangeConflictConfig } from "./product-config.js";
import type { EntityRecord, RecordValue } from "./repository.js";

type Values = Record<string, RecordValue>;

export interface RangeConflictEvaluation {
  ready: boolean;
  invalidOrder: boolean;
  conflicts: EntityRecord[];
}

const normalizedMatch = (value: RecordValue | undefined): string =>
  String(value ?? "").trim().replace(/\s+/gu, " ").toLocaleLowerCase();

const instant = (value: RecordValue | undefined): number | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
};

const isIgnored = (rule: RangeConflictConfig, values: Values): boolean => {
  if (!rule.ignoreWhen) return false;
  const actual = normalizedMatch(values[rule.ignoreWhen.field]);
  return rule.ignoreWhen.values.some((value) => normalizedMatch(value) === actual);
};

/** Pure inclusive-range conflict engine shared by the primary and related forms. */
export function evaluateRangeConflict(
  rule: RangeConflictConfig,
  candidate: Values,
  records: ReadonlyArray<EntityRecord>,
  editingId?: string,
): RangeConflictEvaluation {
  const subject = normalizedMatch(candidate[rule.matchField]);
  const start = instant(candidate[rule.startField]);
  const end = instant(candidate[rule.endField]);
  const ready = subject !== "" && start !== null && end !== null;
  if (!ready) return { ready: false, invalidOrder: false, conflicts: [] };
  if (end < start) return { ready: true, invalidOrder: true, conflicts: [] };
  if (isIgnored(rule, candidate)) return { ready: true, invalidOrder: false, conflicts: [] };
  const conflicts = records.filter((record) => {
    if (record.id === editingId || isIgnored(rule, record.values)) return false;
    if (normalizedMatch(record.values[rule.matchField]) !== subject) return false;
    const existingStart = instant(record.values[rule.startField]);
    const existingEnd = instant(record.values[rule.endField]);
    if (existingStart === null || existingEnd === null || existingEnd < existingStart) return false;
    return start <= existingEnd && existingStart <= end;
  });
  return { ready: true, invalidOrder: false, conflicts };
}
