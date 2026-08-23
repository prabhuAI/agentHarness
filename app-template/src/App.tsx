import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FieldConfig, type PredicateOperator, productConfig, type SummaryConfig } from "./product-config.js";
import { createRepository, EntityRecord, RecordValue } from "./repository.js";
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

const { repository, recoveredFromInvalidData } = createRepository(productConfig.name);

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
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "currency") return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(value));
  if (field.type === "date" || field.type === "datetime") return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(String(value)));
  return String(value);
}

// Format a summary's numeric value, rendering money totals as currency. A `sum`
// totals its `field`; a `sumWhere` totals its `sumField` — either is currency
// when that measure field is a currency field.
function formatSummaryValue(operation: string, measureKey: string | undefined, value: number): string {
  const isCurrency = (operation === "sum" || operation === "sumWhere") && measureKey
    && productConfig.fields.find((field) => field.key === measureKey)?.type === "currency";
  return isCurrency
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : String(value);
}

// Compute one summary metric over the records. `sum` totals a numeric field;
// `sumWhere` totals `sumField` over records matching the predicate; `countWhere`
// counts them; `count` is the record total. Pure and now-injectable for tests.
export function computeSummaryValue(summary: SummaryConfig, records: ReadonlyArray<{ values: Values }>, now: Date = new Date()): number {
  if (summary.operation === "count") return records.length;
  if (summary.operation === "sum") return records.reduce((total, record) => total + Number(record.values[summary.field ?? ""] || 0), 0);
  const matching = records.filter((record) => matchesPredicate(record.values[summary.field ?? ""], summary.operator ?? "nonEmpty", summary.value, now));
  if (summary.operation === "sumWhere") return matching.reduce((total, record) => total + Number(record.values[summary.sumField ?? ""] || 0), 0);
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

export function matchesPredicate(value: RecordValue | undefined, operator: PredicateOperator, expected?: string, now: Date = new Date()) {
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
  if (operator === "nonEmpty") return text !== "";
  if (operator === "empty") return text === "";
  if (operator === "truthy") return value === true || text === "true";
  return value === false || text === "false" || text === "";
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
  const [records, setRecords] = useState<EntityRecord[]>(repository.list());
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  const [editingId, setEditingId] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("updated");
  const [notice, setNotice] = useState(recoveredFromInvalidData ? "Saved data was damaged, so a clean workspace was restored." : "");
  const [undo, setUndo] = useState<EntityRecord | null>(null);
  const entityLabel = productConfig.entityName.charAt(0).toUpperCase() + productConfig.entityName.slice(1);
  const [themePreference, setThemePreference] = useState(loadThemePreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const dialog = useRef<HTMLDialogElement>(null);
  const resolvedTheme = resolveTheme(themePreference, systemDark);

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
  const visible = useMemo(() => derivedRecords.filter((record) => {
    const matchesQuery = !query || productConfig.searchableFields.some((key) => String(record.values[key] ?? "").toLowerCase().includes(query.toLowerCase()));
    const preset = productConfig.filters.find((candidate) => candidate.id === filter);
    const matchesFilter = !preset || matchesPredicate(record.values[preset.field], preset.operator, preset.value);
    return matchesQuery && matchesFilter;
  }).sort((left, right) => compareRecordsBySort(sort, left, right)), [derivedRecords, query, filter, sort]);
  const summaries = useMemo(() => productConfig.summaries.map((summary) => ({ ...summary, value: computeSummaryValue(summary, derivedRecords) })), [derivedRecords]);
  const summaryValueById = useMemo(() => Object.fromEntries(summaries.map((summary) => [summary.id, summary.value])), [summaries]);
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
  const groupField = productConfig.capabilities.group
    ? productConfig.fields.find((field) => field.type === "category" || field.type === "status")
    : undefined;
  const groupedVisible = useMemo(() => {
    if (!groupField) return [];
    const groups = new Map<string, EntityRecord[]>();
    for (const record of visible) {
      const label = String(record.values[groupField.key] ?? "").trim() || "Uncategorized";
      groups.set(label, [...(groups.get(label) ?? []), record]);
    }
    // `visible` is already ordered by the chosen sort, and Map keeps insertion
    // order, so groups appear in the order their first record does under that
    // sort. Re-sorting alphabetically here would override the sort control and
    // make it look like sorting does nothing whenever grouping is on.
    return [...groups.entries()]
      .map(([label, groupedRecords]) => ({ label, records: groupedRecords }));
  }, [groupField, visible]);

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
      for (const field of productConfig.fields) {
        if (field.visibleWhen?.field === key) delete next[field.key];
      }
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validate(values);
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

  const undoDelete = () => {
    if (!undo) return;
    try { repository.restore(undo); setRecords(repository.list()); setNotice(`${entityLabel} restored.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "The item could not be restored."); }
    setUndo(null);
  };

  const dismissNotice = () => { setNotice(""); setUndo(null); };

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

  const recordCard = (record: EntityRecord) => <article className="card" key={record.id}>
    <div className="card-top"><h3>{displayValue(productConfig.fields.find((field) => field.key === productConfig.primaryField)!, record.values[productConfig.primaryField])}</h3>
      <div className="actions">{productConfig.capabilities.edit && <button onClick={() => openEdit(record)}>Edit</button>}{productConfig.capabilities.delete && <button className="danger" onClick={() => remove(record)}>Delete</button>}</div></div>
    <dl>{productConfig.secondaryFields.map((key) => { const field = productConfig.fields.find((candidate) => candidate.key === key); return field && isFieldVisible(field, record.values) ? <div key={key}><dt>{field.label}</dt><dd className={field.type === "status" ? "badge" : ""}>{displayValue(field, record.values[key])}</dd></div> : null; })}</dl>
  </article>;

  return <div
    className={`app genome-${productConfig.genome}`}
    data-layout={design.layout}
    data-tone={design.tone}
    data-density={design.density}
    data-motion={design.motion}
    data-variant={design.variant}
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
      <section className="collection" aria-labelledby="collection-title">
        <h2 id="collection-title" className="sr-only">{productConfig.entityNamePlural}</h2>
        {summaries.length > 0 && <div className="stat-strip" aria-label="Summary">
          {summaries.map((summary) => <div className={`stat-tile tone-${toneForLabel(summary.label)}`} key={summary.id}>
            <span className="stat-icon" aria-hidden="true"><SummaryIcon operation={summary.operation} /></span>
            <span className="stat-body"><strong>{formatSummaryValue(summary.operation, summary.operation === "sumWhere" ? summary.sumField : summary.field, summary.value)}</strong><span>{summary.label}</span></span>
          </div>)}
        </div>}
        <div className="toolbar">
          {productConfig.capabilities.search && <label className="search"><span className="sr-only">Search {productConfig.entityNamePlural}</span><input type="search" placeholder={`Search ${productConfig.entityNamePlural}…`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {productConfig.capabilities.sort && <label className="sort-field"><span className="sr-only">Sort {productConfig.entityNamePlural}</span><select aria-label={`Sort ${productConfig.entityNamePlural}`} value={sort} onChange={(event) => setSort(event.target.value)}>{productConfig.sorts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
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
          : groupField ? <div className="group-list" aria-label={`${productConfig.entityNamePlural} grouped by ${groupField.label}`}>
            {groupedVisible.map((group) => <section className="record-group" key={group.label} aria-labelledby={`group-${group.label.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`}>
              <div className="group-heading"><h3 id={`group-${group.label.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`}>{group.label}</h3><span>{group.records.length}</span></div>
              <div className="grid">{group.records.map(recordCard)}</div>
            </section>)}
          </div> : <div className="grid">{visible.map(recordCard)}</div>}
      </section>
    </main>
    <dialog ref={dialog} onCancel={close}><form onSubmit={submit} noValidate><div className="dialog-head"><div><p className="eyebrow">{editingId ? "Update" : "New entry"}</p><h2>{editingId ? `Edit ${productConfig.entityName}` : `Add ${productConfig.entityName}`}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={close}>×</button></div>
      <div className="form-grid">{productConfig.fields.filter((field) => !field.derive && isFieldVisible(field, values)).map((field) => <Field key={field.key} field={field} value={values[field.key]} error={errors[field.key]} onChange={(value) => updateValue(field.key, value)} />)}</div>
      <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" type="submit">{editingId ? "Save changes" : `Add ${productConfig.entityName}`}</button></div></form></dialog>
  </div>;
}
