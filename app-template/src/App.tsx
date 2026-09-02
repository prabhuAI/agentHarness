import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { type ChartConfig, FieldConfig, type PredicateOperator, productConfig, type QuickActionConfig, type RangeConflictConfig, type SummaryConfig } from "./product-config.js";
import { evaluateFormula } from "./formula.js";
import { createRepository, EntityRecord, RecordValue } from "./repository.js";
import { referenceLabel, referenceOptions, referenceTarget } from "./relations.js";
import { parseImportedRecords, recordsToCsv, recordsToJson } from "./io.js";
import { RelatedWorkspace } from "./RelatedWorkspace.js";
import CustomFeature from "./CustomFeature.js";
import { CollectionView } from "./CollectionView.js";
import { resolveViewPlan } from "./view-plan.js";
import { evaluateRangeConflict } from "./range-conflicts.js";
import {
  loadThemePreference,
  nextPreference,
  paletteFor,
  resolveTheme,
  saveThemePreference,
  systemPrefersDark,
  themeLabel,
  type ResolvedTheme,
  watchSystemTheme,
} from "./theme.js";

type Values = Record<string, RecordValue>;
type Errors = Record<string, string>;
const CUSTOM_OPTION_VALUE = "__agent_cofounder_custom_option__";

const emptyValue = (field: FieldConfig): RecordValue => field.type === "boolean" ? false : "";
// Derived fields are computed at read time, so they are never part of the editable
// form or the stored record — only genuine input fields seed an empty draft. These
// read productConfig.fields live (not a module snapshot) so tests that inject fields
// at runtime still see them.
const emptyValues = (): Values => Object.fromEntries(productConfig.fields.filter((field) => !field.derive).map((field) => [field.key, emptyValue(field)]));

// Calendar parts of a yyyy-mm-dd or ISO date string; null when unparseable.
// Reading the parts directly avoids timezone drift shifting a date by a day.
function dateParts(value: unknown): { y: number; m: number; d: number } | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})/u.exec(text);
  if (parts) return { y: Number(parts[1]), m: Number(parts[2]) - 1, d: Number(parts[3]) };
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

// Whole-day index (UTC) for a date value; null when unparseable.
function dayIndex(value: unknown): number | null {
  const parts = dateParts(value);
  return parts ? Math.floor(Date.UTC(parts.y, parts.m, parts.d) / 86_400_000) : null;
}

// Compute one derived field's value from a record's stored values relative to
// `now`. Returns "" when the inputs are missing/invalid so the record simply
// carries no band rather than a wrong one.
export function computeDerivedValue(field: FieldConfig, values: Values, now: Date): RecordValue {
  const spec = field.derive;
  if (!spec) return values[field.key] ?? "";
  if (spec.kind === "presence") {
    // The status is exactly whether the source field carries a value, so it can
    // never drift from it: filling the source reads as `whenPresent`, clearing
    // it (e.g. via a "Returned" quick action) reads as `whenEmpty`.
    return String(values[spec.sourceField] ?? "").trim() !== "" ? spec.whenPresent : spec.whenEmpty;
  }
  if (spec.kind === "rangeStatus") {
    if (spec.inactiveField && Boolean(values[spec.inactiveField]) && spec.buckets.inactive) return spec.buckets.inactive;
    if (spec.completedField && String(values[spec.completedField] ?? "").trim() !== "" && spec.buckets.completed) return spec.buckets.completed;
    const start = dayIndex(values[spec.startField]);
    const end = dayIndex(values[spec.endField]);
    if (start === null || end === null || end < start) return "";
    const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
    if (today < start) return spec.buckets.upcoming;
    if (today <= end) return spec.buckets.active;
    return spec.buckets.past;
  }
  if (spec.kind === "formula") {
    // Resolve each referenced field to its numeric value; a blank or non-numeric
    // input makes the whole formula unresolved, so the record shows no value.
    const result = evaluateFormula(spec.expression, (id) => {
      const text = String(values[id] ?? "").trim();
      if (text === "") return null;
      const number = Number(text);
      return Number.isFinite(number) ? number : null;
    });
    // Round to at most two decimals so a computed metric reads cleanly (8.33,
    // not 8.333333) while whole numbers stay whole.
    return result === null ? "" : Math.round(result * 100) / 100;
  }
  const from = dayIndex(values[spec.dateField]);
  if (from === null) return "";
  const threshold = spec.thresholdField !== undefined ? Number(values[spec.thresholdField]) : Number(spec.thresholdDays);
  if (!Number.isFinite(threshold)) return "";
  const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
  const daysUntilDue = threshold - (today - from);
  if (daysUntilDue < 0) return spec.buckets.overdue;
  if (daysUntilDue <= (spec.soonWithinDays ?? 0)) return spec.buckets.soon;
  return spec.buckets.ok;
}

// Augment a record's stored values with every derived field, computed against
// `now`. Used wherever values are read for filtering, grouping, counting, or
// display — the raw stored record never contains derived keys.
export function withDerivedValues(values: Values, now: Date = new Date()): Values {
  const derivedFields = productConfig.fields.filter((field) => field.derive);
  if (derivedFields.length === 0) return values;
  const next = { ...values };
  for (const field of derivedFields) next[field.key] = computeDerivedValue(field, values, now);
  return next;
}

function isFieldVisible(field: FieldConfig, values: Values): boolean {
  return !field.visibleWhen || String(values[field.visibleWhen.field] ?? "") === field.visibleWhen.equals;
}

export interface ChartPoint { x: number; y: number; label: string }

// Build a chart's chronological series: one point per record that has both a
// parseable date (x) and a finite number (y), sorted oldest→newest. Records
// missing either axis are skipped so a partial dataset still plots cleanly.
export function chartSeries(chart: ChartConfig, records: ReadonlyArray<{ values: Values }>): ChartPoint[] {
  return records
    .map((record) => {
      const x = dayIndex(record.values[chart.xField]);
      // Number("") is 0, so an empty value must be rejected before coercion,
      // otherwise a record with no measurement would plot as a spurious zero.
      const yText = String(record.values[chart.yField ?? ""] ?? "").trim();
      const y = yText === "" ? Number.NaN : Number(yText);
      const label = String(record.values[chart.xField] ?? "");
      return x !== null && Number.isFinite(y) ? { x, y, label } : null;
    })
    .filter((point): point is ChartPoint => point !== null)
    .sort((left, right) => left.x - right.x);
}

// A dependency-free inline SVG line chart. Renders an empty-state hint until
// there are at least two points to connect.
function TrendChart({ chart, records }: { chart: ChartConfig; records: ReadonlyArray<{ values: Values }> }) {
  const series = chartSeries(chart, records);
  const width = 640;
  const height = 200;
  const padX = 44;
  const padY = 22;
  if (series.length < 2) {
    return <figure className="trend-chart trend-chart-empty">
      <figcaption>{chart.label}</figcaption>
      <p className="trend-chart-hint">Add at least two dated entries to see this trend.</p>
    </figure>;
  }
  const xs = series.map((point) => point.x);
  const ys = series.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number) => padX + ((x - minX) / spanX) * (width - padX * 2);
  const sy = (y: number) => height - padY - ((y - minY) / spanY) * (height - padY * 2);
  const points = series.map((point) => `${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(" ");
  const firstLabel = series[0].label;
  const lastLabel = series[series.length - 1].label;
  return <figure className="trend-chart">
    <figcaption>{chart.label}</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chart.label} line chart with ${series.length} points`} preserveAspectRatio="none">
      <line className="trend-axis" x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} />
      <line className="trend-axis" x1={padX} y1={padY} x2={padX} y2={height - padY} />
      <text className="trend-tick" x={padX - 6} y={sy(maxY)} textAnchor="end" dominantBaseline="middle">{maxY}</text>
      <text className="trend-tick" x={padX - 6} y={sy(minY)} textAnchor="end" dominantBaseline="middle">{minY}</text>
      <polyline className="trend-line" fill="none" points={points} />
      {series.map((point) => <circle className="trend-dot" key={`${point.x}-${point.y}`} cx={sx(point.x)} cy={sy(point.y)} r={3} />)}
      <text className="trend-tick" x={padX} y={height - 6} textAnchor="start">{firstLabel}</text>
      <text className="trend-tick" x={width - padX} y={height - 6} textAnchor="end">{lastLabel}</text>
    </svg>
  </figure>;
}

// Palette for categorical charts; the first slot reuses the product accent so a
// single-series chart matches the app, the rest are fixed, colour-blind-safe hues.
const CHART_PALETTE = ["var(--accent)", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#14b8a6", "#ec4899", "#8b5cf6"];

export interface ChartSlice { label: string; value: number }

// Group records by a bar/pie chart's category axis. Buckets start from the
// field's declared options (so empty groups still appear, in declared order),
// then any custom values encountered are appended in sorted order for
// determinism. Each bucket is a record count, or the sum of the numeric measure
// when `yField` is set.
export function chartBreakdown(chart: ChartConfig, records: ReadonlyArray<{ values: Values }>): ChartSlice[] {
  const field = productConfig.fields.find((candidate) => candidate.key === chart.xField);
  const declared = field?.options ?? [];
  const useSum = Boolean(chart.yField);
  const totals = new Map<string, number>();
  for (const option of declared) totals.set(option, 0);
  for (const record of records) {
    const key = String(record.values[chart.xField] ?? "").trim();
    if (key === "") continue;
    const increment = useSum ? (Number(record.values[chart.yField ?? ""]) || 0) : 1;
    totals.set(key, (totals.get(key) ?? 0) + increment);
  }
  const extras = [...totals.keys()].filter((key) => !declared.includes(key)).sort();
  return [...declared, ...extras].map((label) => ({ label, value: totals.get(label) ?? 0 }));
}

// A dependency-free categorical chart: horizontal bars or a share-of-total donut.
function CategoryChart({ chart, records }: { chart: ChartConfig; records: ReadonlyArray<{ values: Values }> }) {
  const slices = chartBreakdown(chart, records);
  const measure = chart.yField ? productConfig.fields.find((field) => field.key === chart.yField) : undefined;
  const format = (value: number) => measure?.type === "currency"
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (!slices.some((slice) => slice.value !== 0)) {
    return <figure className="trend-chart trend-chart-empty">
      <figcaption>{chart.label}</figcaption>
      <p className="trend-chart-hint">Add entries to see this breakdown.</p>
    </figure>;
  }
  if (chart.type === "pie") {
    const positive = slices.filter((slice) => slice.value > 0);
    const total = positive.reduce((sum, slice) => sum + slice.value, 0) || 1;
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return <figure className="trend-chart">
      <figcaption>{chart.label}</figcaption>
      <div className="pie-chart">
        <svg viewBox="0 0 180 180" role="img" aria-label={`${chart.label} pie chart`}>
          {positive.map((slice, index) => {
            const dash = (slice.value / total) * circumference;
            const arc = <circle key={slice.label} r={radius} cx={90} cy={90} fill="none"
              stroke={CHART_PALETTE[index % CHART_PALETTE.length]} strokeWidth={32}
              strokeDasharray={`${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`}
              strokeDashoffset={(-offset).toFixed(2)} transform="rotate(-90 90 90)" />;
            offset += dash;
            return arc;
          })}
        </svg>
        <ul className="pie-legend">
          {positive.map((slice, index) => <li key={slice.label}>
            <span className="pie-swatch" style={{ background: CHART_PALETTE[index % CHART_PALETTE.length] }} aria-hidden="true" />
            {slice.label} — {format(slice.value)}
          </li>)}
        </ul>
      </div>
    </figure>;
  }
  const max = Math.max(...slices.map((slice) => slice.value), 1);
  return <figure className="trend-chart">
    <figcaption>{chart.label}</figcaption>
    <div className="bar-chart" role="img" aria-label={`${chart.label} bar chart`}>
      {slices.map((slice, index) => <div className="bar-row" key={slice.label}>
        <span className="bar-label">{slice.label}</span>
        <span className="bar-track"><span className="bar-fill" style={{ width: `${(slice.value / max) * 100}%`, background: CHART_PALETTE[index % CHART_PALETTE.length] }} /></span>
        <span className="bar-value">{format(slice.value)}</span>
      </div>)}
    </div>
  </figure>;
}

// Route a chart to its renderer: date trends to the line chart, categorical
// breakdowns to the bar/pie chart.
function ProductChartView({ chart, records }: { chart: ChartConfig; records: ReadonlyArray<{ values: Values }> }) {
  return chart.type === "line"
    ? <TrendChart chart={chart} records={records} />
    : <CategoryChart chart={chart} records={records} />;
}

function validate(values: Values): Errors {
  const errors: Errors = {};
  for (const field of productConfig.fields) {
    if (field.derive || !isFieldVisible(field, values)) continue;
    const value = values[field.key];
    const text = String(value ?? "").trim();
    if (field.required && (text === "" || value === false)) errors[field.key] = `${field.label} is required.`;
    if (text && field.type === "email" && !/^\S+@\S+\.\S+$/u.test(text)) errors[field.key] = "Enter a valid email address.";
    if (text && field.type === "url") {
      try { new URL(text); } catch { errors[field.key] = "Enter a complete URL, including https://"; }
    }
    if (text && (field.type === "number" || field.type === "currency")) {
      const number = Number(text);
      if (!Number.isFinite(number)) errors[field.key] = "Enter a valid number.";
      else if (field.min !== undefined && number < field.min) errors[field.key] = `Must be at least ${field.min}.`;
      else if (field.max !== undefined && number > field.max) errors[field.key] = `Must be at most ${field.max}.`;
    }
  }
  return errors;
}

function Field({ field, value, error, onChange }: {
  field: FieldConfig; value: RecordValue; error?: string; onChange: (value: RecordValue) => void;
}) {
  const id = `field-${field.key}`;
  const textValue = String(value ?? "");
  const options = field.options ?? [];
  const [customMode, setCustomMode] = useState(
    () => Boolean(field.allowCustom && textValue && !options.includes(textValue)),
  );
  useEffect(() => {
    if (!field.allowCustom || !textValue || options.includes(textValue)) setCustomMode(false);
    else setCustomMode(true);
  }, [field.allowCustom, field.options, textValue]);
  const common = { id, name: field.key, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined };
  let control;
  if (field.type === "longText") {
    control = <textarea {...common} rows={4} value={textValue} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  } else if ((field.type === "category" || field.type === "status") && options.length > 0) {
    control = <div className="choice-control"><select {...common} value={customMode ? CUSTOM_OPTION_VALUE : textValue} onChange={(event) => {
      if (event.target.value === CUSTOM_OPTION_VALUE) {
        setCustomMode(true);
        onChange("");
      } else {
        setCustomMode(false);
        onChange(event.target.value);
      }
    }}>
      <option value="">Choose {field.label.toLowerCase()}</option>
      {options.map((option) => <option key={option}>{option}</option>)}
      {field.allowCustom && <option value={CUSTOM_OPTION_VALUE}>Other…</option>}
    </select>{customMode && <input
      id={`${id}-custom`}
      name={`${field.key}-custom`}
      aria-label={`Custom ${field.label}`}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
      autoFocus
      value={textValue}
      placeholder={`Enter custom ${field.label.toLowerCase()}`}
      onChange={(event) => onChange(event.target.value)}
    />}</div>;
  } else if (field.type === "reference") {
    const target = referenceTarget(field);
    const referenceChoices = target ? referenceOptions(target) : [];
    control = <select {...common} value={textValue} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose {field.label.toLowerCase()}</option>
      {referenceChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select>;
  } else if (field.type === "boolean") {
    control = <label className="check"><input {...common} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span>Yes</span></label>;
  } else {
    const inputType = field.type === "currency" || field.type === "number" ? "number" : field.type === "datetime" ? "datetime-local" : field.type === "category" || field.type === "status" ? "text" : field.type;
    control = <input {...common} type={inputType} value={textValue} min={field.min} max={field.max} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  }
  return <div className={`field ${field.type === "longText" ? "field-wide" : ""}`}>
    <label htmlFor={id}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>
    {control}
    {error && <small id={`${id}-error`} className="error">{error}</small>}
  </div>;
}

function displayValue(field: FieldConfig, value: RecordValue | undefined) {
  if (value === undefined || value === "") return "—";
  if (field.type === "reference") {
    const target = referenceTarget(field);
    return target ? referenceLabel(target, String(value)) : String(value);
  }
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "currency") return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(value));
  if (field.type === "date" || field.type === "datetime") return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(String(value)));
  return String(value);
}

// Format a summary's numeric value, rendering money totals as currency. A `sum`
// totals its `field`; a `sumWhere` totals its `sumField` — either is currency
// when that measure field is a currency field.
const MEASURE_OPERATIONS = new Set(["sum", "sumWhere", "average", "avgWhere", "min", "minWhere", "max", "maxWhere"]);
function formatSummaryValue(operation: string, measureKey: string | undefined, value: number): string {
  const isCurrency = MEASURE_OPERATIONS.has(operation) && measureKey
    && productConfig.fields.find((field) => field.key === measureKey)?.type === "currency";
  if (isCurrency) return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  // An average can be fractional; keep counts and whole sums as plain integers.
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Compute one summary metric over the records. `sum` totals a numeric field;
// `sumWhere` totals `sumField` over records matching the predicate; `countWhere`
// counts them; `count` is the record total. Pure and now-injectable for tests.
export function computeSummaryValue(summary: SummaryConfig, records: ReadonlyArray<{ values: Values }>, now: Date = new Date()): number {
  if (summary.operation === "count") return records.length;
  // Bare aggregates reduce `field` over every record.
  const measure = (record: { values: Values }) => Number(record.values[summary.field ?? ""] || 0);
  if (summary.operation === "sum") return records.reduce((total, record) => total + measure(record), 0);
  if (summary.operation === "average") return records.length ? records.reduce((total, record) => total + measure(record), 0) / records.length : 0;
  if (summary.operation === "min") return records.length ? Math.min(...records.map(measure)) : 0;
  if (summary.operation === "max") return records.length ? Math.max(...records.map(measure)) : 0;
  // Conditional aggregates reduce `sumField` over the records matching the predicate.
  const matching = records.filter((record) => matchesRecordPredicate(record, {
    field: summary.field ?? "", operator: summary.operator ?? "nonEmpty", value: summary.value, valueEnd: summary.valueEnd,
  }, now));
  const weighed = (record: { values: Values }) => Number(record.values[summary.sumField ?? ""] || 0);
  if (summary.operation === "sumWhere") return matching.reduce((total, record) => total + weighed(record), 0);
  if (summary.operation === "avgWhere") return matching.length ? matching.reduce((total, record) => total + weighed(record), 0) / matching.length : 0;
  if (summary.operation === "minWhere") return matching.length ? Math.min(...matching.map(weighed)) : 0;
  if (summary.operation === "maxWhere") return matching.length ? Math.max(...matching.map(weighed)) : 0;
  return matching.length;
}

// Compare two records for the chosen sort option. `updated`/`created` order by
// timestamp; a field option compares that field's value — numerically for
// number/currency, else textually (numeric-aware) — honouring its direction.
export function compareRecordsBySort(
  sortId: string,
  left: { values: Values; createdAt: string; updatedAt: string },
  right: { values: Values; createdAt: string; updatedAt: string },
): number {
  const option = productConfig.sorts.find((sort) => sort.id === sortId);
  if (!option || option.id === "updated") return right.updatedAt.localeCompare(left.updatedAt);
  if (option.id === "created") return left.createdAt.localeCompare(right.createdAt);
  const key = option.field ?? productConfig.primaryField;
  const a = left.values[key];
  const b = right.values[key];
  const cmp = option.type === "number" || option.type === "currency"
    ? (Number(a) || 0) - (Number(b) || 0)
    : String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
  return option.direction === "desc" ? -cmp : cmp;
}

// Three-way compare of a stored value against an expected bound: numeric when
// both parse as finite numbers, otherwise a numeric-aware string compare (ISO
// dates sort chronologically as text). Returns null when either side is blank,
// so a comparison against a missing value never matches.
function compareValues(value: RecordValue | undefined, expected: string | undefined): number | null {
  if (expected === undefined) return null;
  const av = String(value ?? "").trim();
  const bv = String(expected).trim();
  if (av === "" || bv === "") return null;
  const a = Number(av);
  const b = Number(bv);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.sign(a - b);
  return Math.sign(av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }));
}

export function matchesPredicate(value: RecordValue | undefined, operator: PredicateOperator, expected?: string, now: Date = new Date(), valueEnd?: string) {
  const text = String(value ?? "").trim();
  if (operator === "today" || operator === "thisWeek" || operator === "thisMonth") {
    const parts = dateParts(value);
    if (!parts) return false;
    if (operator === "thisMonth") return parts.y === now.getFullYear() && parts.m === now.getMonth();
    if (operator === "today") return parts.y === now.getFullYear() && parts.m === now.getMonth() && parts.d === now.getDate();
    // thisWeek: within the Monday–Sunday week containing `now` (calendar-day math).
    const nowIndex = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
    const mondayOffset = (new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).getUTCDay() + 6) % 7;
    const weekStart = nowIndex - mondayOffset;
    const index = dayIndex(value);
    return index !== null && index >= weekStart && index <= weekStart + 6;
  }
  if (operator === "equals") return text === String(expected ?? "");
  if (operator === "notEquals") return text !== String(expected ?? "") && (valueEnd === undefined || text !== valueEnd);
  if (operator === "contains") return text.toLowerCase().includes(String(expected ?? "").toLowerCase());
  if (operator === "nonEmpty") return text !== "";
  if (operator === "empty") return text === "";
  if (operator === "truthy") return value === true || text === "true";
  if (operator === "falsy") return value === false || text === "false" || text === "";
  // A comparison bound may explicitly mean the current calendar day. Keeping
  // this dynamic lets "future reservations" remain correct after every refresh.
  const pad = (part: number) => String(part).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const resolvedExpected = expected?.trim().toLowerCase() === "today" ? today : expected;
  const resolvedEnd = valueEnd?.trim().toLowerCase() === "today" ? today : valueEnd;
  // Range/comparison. before/after are date-field aliases of lessThan/greaterThan;
  // between is an inclusive [expected, valueEnd] window.
  if (operator === "between") {
    const low = compareValues(value, resolvedExpected);
    const high = compareValues(value, resolvedEnd);
    return low !== null && high !== null && low >= 0 && high <= 0;
  }
  const cmp = compareValues(value, resolvedExpected);
  if (cmp === null) return false;
  if (operator === "lessThan" || operator === "before") return cmp < 0;
  if (operator === "greaterThan" || operator === "after") return cmp > 0;
  if (operator === "atMost") return cmp <= 0;
  if (operator === "atLeast") return cmp >= 0;
  return false;
}

export function matchesRecordPredicate(
  record: Pick<EntityRecord, "values">,
  predicate: { field: string; operator: PredicateOperator; value?: string; valueEnd?: string },
  now: Date = new Date(),
): boolean {
  // A numeric/date comparison may name another field as its bound (for example
  // units_on_hand <= reorder_level). Resolve that field per record; ordinary
  // literal values continue through unchanged.
  const resolve = (candidate: string | undefined): string | undefined => candidate
    && Object.prototype.hasOwnProperty.call(record.values, candidate)
    ? String(record.values[candidate] ?? "")
    : candidate;
  return matchesPredicate(record.values[predicate.field], predicate.operator, resolve(predicate.value), now, resolve(predicate.valueEnd));
}

function ThemeIcon({ resolved }: { resolved: ResolvedTheme }) {
  if (resolved === "dark") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 11.8A6.5 6.5 0 0 1 8.2 3.5a6.5 6.5 0 1 0 8.3 8.3z"/></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.5v2.2M10 16.3v2.2M1.5 10h2.2M16.3 10h2.2M4 4l1.6 1.6M14.4 14.4 16 16M16 4l-1.6 1.6M5.6 14.4 4 16"/></svg>;
}

function GenomeGlyph({ genome }: { genome: typeof productConfig.genome }) {
  if (genome === "workflow") return <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="10" width="18" height="16" rx="4"/><rect x="38" y="38" width="18" height="16" rx="4"/><path d="M26 18h12a8 8 0 0 1 8 8v12M38 46H26a8 8 0 0 1-8-8V26"/></svg>;
  if (genome === "catalog") return <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="9" width="20" height="20" rx="5"/><rect x="36" y="9" width="20" height="20" rx="5"/><rect x="8" y="37" width="20" height="18" rx="5"/><rect x="36" y="37" width="20" height="18" rx="5"/></svg>;
  if (genome === "planner") return <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="13" width="48" height="42" rx="8"/><path d="M8 26h48M20 8v10M44 8v10M19 37h10M35 37h10M19 46h10"/></svg>;
  if (genome === "dashboard") return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 51V35h10v16M27 51V22h10v29M44 51V11h10v40M7 51h50"/></svg>;
  return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="23"/><path d="M18 34l9 9 19-23"/></svg>;
}

type Tone = "danger" | "warn" | "success" | "neutral";
function toneForLabel(label: string): Tone {
  const l = label.toLowerCase();
  if (/(overdue|late|expired|blocked|rejected|failed|urgent|unpaid|out of stock|critical|missing)/u.test(l)) return "danger";
  if (/(due|soon|pending|in progress|waiting|review|low|lent|borrow|out\b|open|todo|scheduled)/u.test(l)) return "warn";
  if (/(good|done|complete|paid|returned|on shelf|available|active|healthy|resolved|approved|in stock|closed|finished)/u.test(l)) return "success";
  return "neutral";
}

function SummaryIcon({ operation }: { operation: string }) {
  if (operation === "sum") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 4H5l6 6-6 6h10"/></svg>;
  if (operation === "count") return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="3.5" width="13" height="13" rx="3.5"/><path d="M7 10h6M10 7v6"/></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M7.2 10.2l1.9 1.9 3.7-4.2"/></svg>;
}

export function App() {
  // Bind persistence to this mounted application instance. This avoids stale
  // in-memory state surviving a remount after storage was externally cleared,
  // while a normal remount still rehydrates the same browser-local records.
  const { repository, recoveredFromInvalidData } = useMemo(() => createRepository(productConfig.name), []);
  const [records, setRecords] = useState<EntityRecord[]>(repository.list());
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  const [editingId, setEditingId] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(productConfig.priority
    ? "priority"
    : productConfig.presentation.primary === "agenda" && productConfig.presentation.dateField
      ? `by_${productConfig.presentation.dateField}`
      : "updated");
  const [notice, setNotice] = useState(recoveredFromInvalidData ? "Saved data was damaged, so a clean workspace was restored." : "");
  const [undo, setUndo] = useState<EntityRecord | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string>();
  const entityLabel = productConfig.entityName.charAt(0).toUpperCase() + productConfig.entityName.slice(1);
  const [themePreference, setThemePreference] = useState(loadThemePreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const dialog = useRef<HTMLDialogElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const resolvedTheme = resolveTheme(themePreference, systemDark);
  const viewPlan = resolveViewPlan(productConfig);

  useEffect(() => { document.title = productConfig.name; }, []);
  useEffect(() => watchSystemTheme(setSystemDark), []);
  useEffect(() => { saveThemePreference(themePreference); }, [themePreference]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = resolvedTheme;
    root.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  useEffect(() => {
    const firstInvalid = productConfig.fields.find((field) => errors[field.key] && isFieldVisible(field, values));
    if (firstInvalid) document.getElementById(`field-${firstInvalid.key}`)?.focus();
  }, [errors]);

  // Records with every derived field computed against today, so filtering,
  // grouping, counting, and display all see the live values, not the raw store.
  const derivedRecords = useMemo(() => records.map((record) => ({ ...record, values: withDerivedValues(record.values) })), [records]);
  const rangeEvaluations = useMemo(() => productConfig.rangeConflicts.map((rule) => ({
    rule,
    evaluation: evaluateRangeConflict(rule, withDerivedValues(values), derivedRecords, editingId),
  })), [values, derivedRecords, editingId]);
  const visible = useMemo(() => derivedRecords.filter((record) => {
    const matchesQuery = !query || productConfig.searchableFields.some((key) => String(record.values[key] ?? "").toLowerCase().includes(query.toLowerCase()));
    const preset = productConfig.filters.find((candidate) => candidate.id === filter);
    const matchesFilter = !preset || matchesRecordPredicate(record, preset);
    return matchesQuery && matchesFilter;
  }).sort((left, right) => {
    if (sort === "priority" && productConfig.priority?.filter) {
      const predicate = productConfig.priority.filter;
      const leftEligible = matchesRecordPredicate(left, predicate);
      const rightEligible = matchesRecordPredicate(right, predicate);
      if (leftEligible !== rightEligible) return leftEligible ? -1 : 1;
    }
    return compareRecordsBySort(sort, left, right);
  }), [derivedRecords, query, filter, sort]);
  const priorityRecordId = useMemo(() => {
    const priority = productConfig.priority;
    if (!priority) return undefined;
    return [...derivedRecords]
      .filter((record) => !priority.filter || matchesRecordPredicate(record, priority.filter))
      .sort((left, right) => compareRecordsBySort("priority", left, right))[0]?.id;
  }, [derivedRecords]);
  const summaries = useMemo(() => productConfig.summaries.map((summary) => ({ ...summary, value: computeSummaryValue(summary, derivedRecords) })), [derivedRecords]);
  const summaryValueById = useMemo(() => Object.fromEntries(summaries.map((summary) => [summary.id, summary.value])), [summaries]);
  // Only headline metrics belong in the stat strip. A per-facet count that is
  // already surfaced as a filter-chip badge would just be shown twice, so drop
  // it from the tiles and let the chip carry the number. Matching uses the raw
  // config summaries (the `summaries` memo overwrites `value` with the computed
  // count, so its predicate value is no longer comparable).
  const facetSummaryIds = useMemo(() => new Set(productConfig.summaries
    .filter((summary) => productConfig.filters.some((preset) =>
      summary.operation === "countWhere"
      && summary.field === preset.field
      && String(summary.operator ?? "") === String(preset.operator ?? "")
      && String(summary.value ?? "") === String(preset.value ?? "")))
    .map((summary) => summary.id)), []);
  const tileSummaries = useMemo(() => summaries.filter((summary) => !facetSummaryIds.has(summary.id)), [summaries, facetSummaryIds]);
  const filterCount = (preset: (typeof productConfig.filters)[number]): number | undefined => {
    // Only a count-type summary is a valid chip badge; a sumWhere breakdown holds
    // a money total, which must not be shown as if it were a record count.
    const match = productConfig.summaries.find((summary) =>
      summary.operation === "countWhere"
      && summary.field === preset.field
      && String(summary.operator ?? "") === String(preset.operator ?? "")
      && String(summary.value ?? "") === String(preset.value ?? ""));
    return match ? summaryValueById[match.id] : undefined;
  };
  const openCreate = () => { setEditingId(undefined); setValues(emptyValues()); setErrors({}); dialog.current?.showModal(); };
  const openEdit = (record: EntityRecord) => { setEditingId(record.id); setValues({ ...emptyValues(), ...record.values }); setErrors({}); dialog.current?.showModal(); };
  const close = () => dialog.current?.close();

  const updateValue = (key: string, value: RecordValue) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      for (const field of productConfig.fields) {
        if (field.visibleWhen && !isFieldVisible(field, next)) next[field.key] = emptyValue(field);
      }
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      for (const rule of productConfig.rangeConflicts) {
        if ([rule.matchField, rule.startField, rule.endField, rule.ignoreWhen?.field].includes(key)) {
          delete next[rule.matchField];
          delete next[rule.endField];
        }
      }
      for (const field of productConfig.fields) {
        if (field.visibleWhen?.field === key) delete next[field.key];
      }
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validate(values);
    for (const { rule, evaluation } of rangeEvaluations) {
      if (evaluation.invalidOrder) nextErrors[rule.endField] = "End must be on or after start.";
      else if (evaluation.conflicts.length > 0) nextErrors[rule.matchField] = "Unavailable for this period. Choose different dates or another item.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      if (editingId) repository.update(editingId, values); else repository.create(values);
      setRecords(repository.list());
      setUndo(null);
      setNotice(`${entityLabel} ${editingId ? "updated" : "added"}.`);
      close();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The change could not be saved."); }
  };

  const remove = (record: EntityRecord) => {
    try {
      repository.remove(record.id);
      setRecords(repository.list());
      setUndo(record);
      setNotice(`${entityLabel} deleted.`);
    } catch (error) {
      setUndo(null);
      setNotice(error instanceof Error ? error.message : "The item could not be deleted.");
    }
  };

  // A quick action mutates one field on a record and saves immediately, no dialog.
  // Each verb maps to a deterministic new value computed from the current one.
  const runQuickAction = (record: EntityRecord, action: QuickActionConfig) => {
    const field = productConfig.fields.find((candidate) => candidate.key === action.field);
    const current = record.values[action.field];
    let next: RecordValue = "";
    if (action.set === "today" || action.set === "now") {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const stampTime = action.set === "now" || field?.type === "datetime";
      next = stampTime ? `${day}T${pad(now.getHours())}:${pad(now.getMinutes())}` : day;
    } else if (action.set === "increment") {
      next = (Number(current) || 0) + (action.amount ?? 1);
    } else if (action.set === "toggle") {
      next = !(current === true || current === "true");
    } else if (action.set === "setValue") {
      next = action.value ?? "";
    }
    try {
      repository.update(record.id, { ...record.values, [action.field]: next });
      setRecords(repository.list());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The update could not be saved.");
    }
  };

  const undoDelete = () => {
    if (!undo) return;
    try { repository.restore(undo); setRecords(repository.list()); setNotice(`${entityLabel} restored.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "The item could not be restored."); }
    setUndo(null);
  };

  const dismissNotice = () => { setNotice(""); setUndo(null); };

  // Trigger a client-side file download of `text` with no external dependency.
  const downloadFile = (filename: string, mime: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const slug = productConfig.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "records";
  const exportRecords = (format: "csv" | "json") => {
    const text = format === "csv" ? recordsToCsv(derivedRecords) : recordsToJson(records);
    downloadFile(`${slug}.${format}`, format === "csv" ? "text/csv" : "application/json", text);
  };
  const importRecords = async (file: File) => {
    try {
      const parsed = parseImportedRecords(await file.text());
      if (parsed.length === 0) { setNotice("No importable records found in that file."); return; }
      for (const values of parsed) repository.create(values);
      setRecords(repository.list());
      setNotice(`Imported ${parsed.length} ${parsed.length === 1 ? productConfig.entityName : productConfig.entityNamePlural}.`);
    } catch {
      setNotice("That file could not be imported. Expected a JSON array of records.");
    }
  };

  const design = productConfig.design;
  const palette = paletteFor(design, resolvedTheme);
  const cycleTheme = () => setThemePreference(nextPreference);
  const designStyle = {
    "--canvas": palette.canvas,
    "--surface": palette.surface,
    "--surface-alt": palette.surfaceAlt,
    "--ink": palette.ink,
    "--muted": palette.muted,
    "--border": palette.border,
    "--accent": palette.accent,
    "--accent-text": palette.accentText,
    "--topbar": palette.topbar,
    "--topbar-text": palette.topbarText,
    "--danger": palette.danger,
    "--font-body": design.typography.body,
    "--font-display": design.typography.display,
    "--card-radius": `${design.shape.cardRadius}px`,
    "--panel-radius": `${design.shape.panelRadius}px`,
    "--page-space": `${design.spacing.page}px`,
    "--panel-space": `${design.spacing.panel}px`,
    "--layout-gap": `${design.spacing.gap}px`,
  } as CSSProperties;

  const recordCard = (record: EntityRecord, view = viewPlan.primary) => <article data-record-id={record.id} className={`card record-${view}${record.id === priorityRecordId ? " is-priority" : ""}${record.id === selectedRecordId ? " is-selected" : ""}`} key={record.id}>
    <div className="card-top"><h3>{record.id === priorityRecordId && <span className="priority-badge">{productConfig.priority?.label}</span>}<span>{displayValue(productConfig.fields.find((field) => field.key === productConfig.primaryField)!, record.values[productConfig.primaryField])}</span></h3>
      <div className="actions">{productConfig.quickActions.map((action) => <button key={action.id} type="button" className="quick-action" onClick={() => runQuickAction(record, action)}>{action.label}</button>)}{productConfig.capabilities.edit && <button onClick={() => openEdit(record)}>Edit</button>}{productConfig.capabilities.delete && <button className="danger" onClick={() => remove(record)}>Delete</button>}</div></div>
    <dl>{productConfig.secondaryFields.map((key) => { const field = productConfig.fields.find((candidate) => candidate.key === key); const value = record.values[key]; return field && isFieldVisible(field, record.values) && value !== undefined && value !== null && value !== "" ? <div key={key}><dt>{field.label}</dt><dd className={field.type === "status" ? "badge" : ""}>{displayValue(field, value)}</dd></div> : null; })}</dl>
  </article>;

  // Table view renders a real <table> so columns align to their headers reliably
  // (CSS-grid card rows could not keep the header and cells in lockstep).
  const primaryFieldConfig = productConfig.fields.find((field) => field.key === productConfig.primaryField)!;
  const tableColumns = productConfig.secondaryFields
    .map((key) => productConfig.fields.find((field) => field.key === key))
    .filter((field): field is FieldConfig => Boolean(field));
  const hasRowActions = productConfig.capabilities.edit || productConfig.capabilities.delete || productConfig.quickActions.length > 0;
  const fieldLabel = (key: string): string => productConfig.fields.find((field) => field.key === key)?.label ?? key;
  const conflictDescription = (rule: RangeConflictConfig, record: EntityRecord): string => {
    const range = `${String(record.values[rule.startField] ?? "?")} – ${String(record.values[rule.endField] ?? "?")}`;
    const details = (rule.detailFields ?? []).map((key) => `${fieldLabel(key)}: ${String(record.values[key] ?? "—")}`).join(", ");
    return details ? `${range} (${details})` : range;
  };
  const recordTable = (rows: EntityRecord[]) => <div className="table-view" role="region" aria-label={`${productConfig.entityNamePlural} table`}>
    <table className="data-table">
      <thead><tr>
        <th scope="col">{primaryFieldConfig.label}</th>
        {tableColumns.map((field) => <th key={field.key} scope="col">{field.label}</th>)}
        {hasRowActions && <th scope="col" className="col-actions">Actions</th>}
      </tr></thead>
      <tbody>{rows.map((record) => <tr key={record.id} data-record-id={record.id} className={`${record.id === priorityRecordId ? "is-priority" : ""}${record.id === selectedRecordId ? " is-selected" : ""}`.trim()}>
        <th scope="row">{record.id === priorityRecordId && <span className="priority-badge">{productConfig.priority?.label}</span>}{displayValue(primaryFieldConfig, record.values[productConfig.primaryField])}</th>
        {tableColumns.map((field) => { const value = record.values[field.key]; const shown = isFieldVisible(field, record.values) && value !== undefined && value !== null && value !== ""; return <td key={field.key} data-label={field.label}>{shown ? <span className={field.type === "status" ? "badge" : ""}>{displayValue(field, value)}</span> : <span className="muted-cell">—</span>}</td>; })}
        {hasRowActions && <td className="col-actions"><div className="actions">{productConfig.quickActions.map((action) => <button key={action.id} type="button" className="quick-action" onClick={() => runQuickAction(record, action)}>{action.label}</button>)}{productConfig.capabilities.edit && <button onClick={() => openEdit(record)}>Edit</button>}{productConfig.capabilities.delete && <button className="danger" onClick={() => remove(record)}>Delete</button>}</div></td>}
      </tr>)}</tbody>
    </table>
  </div>;

  return <div
    className={`app genome-${productConfig.genome}`}
    data-layout={design.layout}
    data-tone={design.tone}
    data-density={design.density}
    data-motion={design.motion}
    data-variant={design.variant}
    data-view={viewPlan.primary}
    data-navigation={viewPlan.navigation}
    data-presentation-variant={viewPlan.variant}
    style={designStyle}
  >
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar"><a className="brand" href="#main"><span className="brand-mark"><GenomeGlyph genome={productConfig.genome} /></span><span>{productConfig.name}</span></a>
      <div className="topbar-tools">
        <span className="local-pill"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 9V6.8a3.5 3.5 0 0 1 7 0V9M5 9h10v8H5z"/></svg>Private · saved locally</span>
        <button type="button" className="theme-toggle" onClick={cycleTheme} aria-label={`Theme: ${themeLabel(themePreference, resolvedTheme)}. Activate to change.`} title={`Theme: ${themeLabel(themePreference, resolvedTheme)}`}>
          <ThemeIcon resolved={resolvedTheme} /><span className="theme-toggle-text">{themeLabel(themePreference, resolvedTheme)}</span>
        </button>
      </div></header>
    <main id="main">
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow">{productConfig.eyebrow} workspace</p><h1>{productConfig.name}</h1>{productConfig.tagline && <p>{productConfig.tagline}</p>}</div>
        {productConfig.capabilities.create && <button className="primary hero-action" onClick={openCreate}><span aria-hidden="true">+</span> Add {productConfig.entityName}</button>}
      </section>
      {notice && <div className="notice" role="status"><span>{notice}</span><div className="notice-actions">{undo && <button type="button" className="notice-undo" onClick={undoDelete}>Undo</button>}<button className="icon-button notice-dismiss" aria-label="Dismiss message" onClick={dismissNotice}>×</button></div></div>}
      <CustomFeature
        records={derivedRecords}
        onRecordsChanged={() => setRecords(repository.list())}
        onSelectRecord={(id) => {
          setSelectedRecordId(id);
          requestAnimationFrame(() => {
            const target = [...document.querySelectorAll<HTMLElement>("[data-record-id]")]
              .find((element) => element.dataset.recordId === id);
            target?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }}
      />
      {(productConfig.entities?.length ?? 0) > 1 && <RelatedWorkspace primaryRecords={records} />}
      <section className="collection" aria-labelledby="collection-title">
        <h2 id="collection-title" className="sr-only">{productConfig.entityNamePlural}</h2>
        {tileSummaries.length > 0 && <div className="stat-strip" aria-label="Summary">
          {tileSummaries.map((summary) => <div className={`stat-tile tone-${toneForLabel(summary.label)}`} data-summary-id={summary.id} key={summary.id}>
            <span className="stat-icon" aria-hidden="true"><SummaryIcon operation={summary.operation} /></span>
            <span className="stat-body"><strong>{formatSummaryValue(summary.operation, summary.operation.endsWith("Where") && summary.operation !== "countWhere" ? summary.sumField : summary.field, summary.value)}</strong><span>{summary.label}</span></span>
          </div>)}
        </div>}
        {productConfig.charts.length > 0 && <div className="chart-strip" aria-label="Trends">
          {productConfig.charts.map((chart) => <ProductChartView key={chart.id} chart={chart} records={derivedRecords} />)}
        </div>}
        <div className="toolbar">
          {productConfig.capabilities.search && <label className="search"><span className="sr-only">Search {productConfig.entityNamePlural}</span><input type="search" placeholder={`Search ${productConfig.entityNamePlural}…`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {productConfig.capabilities.sort && <label className="sort-field"><span className="sr-only">Sort {productConfig.entityNamePlural}</span><select aria-label={`Sort ${productConfig.entityNamePlural}`} value={sort} onChange={(event) => setSort(event.target.value)}>{productConfig.sorts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
          {productConfig.capabilities.export && <div className="data-tools" role="group" aria-label="Export and import">
            <button type="button" className="secondary" onClick={() => exportRecords("csv")} disabled={records.length === 0}>Export CSV</button>
            <button type="button" className="secondary" onClick={() => exportRecords("json")} disabled={records.length === 0}>Export JSON</button>
            {productConfig.capabilities.create && <>
              <button type="button" className="secondary" onClick={() => importInput.current?.click()}>Import</button>
              <input ref={importInput} type="file" accept="application/json,.json" className="sr-only" aria-label="Import records from JSON file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRecords(file); event.target.value = ""; }} />
            </>}
          </div>}
        </div>
        {productConfig.filters.length > 0 && <div className="filter-chips" role="group" aria-label={`Filter ${productConfig.entityNamePlural}`}>
          <button type="button" className={`chip${filter === "all" ? " is-active" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {productConfig.entityNamePlural}</button>
          {productConfig.filters.map((preset) => {
            const active = filter === preset.id;
            const count = filterCount(preset);
            return <button key={preset.id} type="button" className={`chip tone-${toneForLabel(preset.label)}${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => setFilter(active ? "all" : preset.id)}>
              <span className="chip-dot" aria-hidden="true" />{preset.label}{count !== undefined && <span className="chip-count">{count}</span>}
            </button>;
          })}
        </div>}
        <div className="result-count" aria-live="polite">{visible.length === records.length ? `${records.length} ${records.length === 1 ? productConfig.entityName : productConfig.entityNamePlural}` : `${visible.length} of ${records.length} shown`}</div>
        {visible.length === 0 ? <div className="empty"><span className="empty-icon">◇</span><h3>{records.length ? "Nothing matches that view" : `No ${productConfig.entityNamePlural} yet`}</h3><p>{records.length ? "Try another search or filter." : `Add your first ${productConfig.entityName} to get started.`}</p>{!records.length && productConfig.capabilities.create && <button className="secondary" onClick={openCreate}>Add {productConfig.entityName}</button>}</div>
          : viewPlan.primary === "table" ? recordTable(visible)
          : <CollectionView records={visible} renderRecord={recordCard} />}
      </section>
    </main>
    <dialog ref={dialog} onCancel={close}><form onSubmit={submit} noValidate><div className="dialog-head"><div><p className="eyebrow">{editingId ? "Update" : "New entry"}</p><h2>{editingId ? `Edit ${productConfig.entityName}` : `Add ${productConfig.entityName}`}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={close}>×</button></div>
      <div className="form-grid">{productConfig.fields.filter((field) => !field.derive && isFieldVisible(field, values)).map((field) => <Field key={field.key} field={field} value={values[field.key]} error={errors[field.key]} onChange={(value) => updateValue(field.key, value)} />)}</div>
      {rangeEvaluations.map(({ rule, evaluation }) => !evaluation.ready || evaluation.invalidOrder ? null : evaluation.conflicts.length === 0
        ? <div className="availability availability-free" role="status" key={rule.id}>Available for this period.</div>
        : <div className="availability availability-conflict" role="alert" key={rule.id}>
          <strong>Unavailable for this period.</strong>
          <span>Conflicts with {evaluation.conflicts.length} existing {evaluation.conflicts.length === 1 ? productConfig.entityName : productConfig.entityNamePlural}:</span>
          <ul>{evaluation.conflicts.map((record) => <li key={record.id}>{conflictDescription(rule, record)}</li>)}</ul>
        </div>)}
      <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" type="submit">{editingId ? "Save changes" : `Add ${productConfig.entityName}`}</button></div></form></dialog>
  </div>;
}
