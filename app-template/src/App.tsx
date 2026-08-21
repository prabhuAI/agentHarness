import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FieldConfig, type PredicateOperator, productConfig } from "./product-config.js";
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
const emptyValues = (): Values => Object.fromEntries(productConfig.fields.map((field) => [field.key, emptyValue(field)]));

function isFieldVisible(field: FieldConfig, values: Values): boolean {
  return !field.visibleWhen || String(values[field.visibleWhen.field] ?? "") === field.visibleWhen.equals;
}

function validate(values: Values): Errors {
  const errors: Errors = {};
  for (const field of productConfig.fields) {
    if (!isFieldVisible(field, values)) continue;
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

function matchesPredicate(value: RecordValue | undefined, operator: PredicateOperator, expected?: string) {
  const text = String(value ?? "").trim();
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

  const visible = useMemo(() => records.filter((record) => {
    const matchesQuery = !query || productConfig.searchableFields.some((key) => String(record.values[key] ?? "").toLowerCase().includes(query.toLowerCase()));
    const preset = productConfig.filters.find((candidate) => candidate.id === filter);
    const matchesFilter = !preset || matchesPredicate(record.values[preset.field], preset.operator, preset.value);
    return matchesQuery && matchesFilter;
  }).sort((left, right) => {
    if (sort === "title") return String(left.values[productConfig.primaryField] ?? "").localeCompare(String(right.values[productConfig.primaryField] ?? ""));
    if (sort === "created") return left.createdAt.localeCompare(right.createdAt);
    return right.updatedAt.localeCompare(left.updatedAt);
  }), [records, query, filter, sort]);
  const summaries = useMemo(() => productConfig.summaries.map((summary) => {
    if (summary.operation === "count") return { ...summary, value: records.length };
    if (summary.operation === "sum") return { ...summary, value: records.reduce((total, record) => total + Number(record.values[summary.field ?? ""] || 0), 0) };
    return { ...summary, value: records.filter((record) => matchesPredicate(record.values[summary.field ?? ""], summary.operator ?? "nonEmpty", summary.value)).length };
  }), [records]);
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
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
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
        <div className="hero-copy"><p className="eyebrow">{productConfig.eyebrow} workspace</p><h1>{productConfig.name}</h1>{productConfig.tagline && <p>{productConfig.tagline}</p>}{productConfig.capabilities.create && <button className="primary hero-action" onClick={openCreate}><span aria-hidden="true">+</span> Add {productConfig.entityName}</button>}</div>
        <div className="hero-art" aria-hidden="true"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><span className="hero-glyph"><GenomeGlyph genome={productConfig.genome} /></span></div>
      </section>
      {notice && <div className="notice" role="status"><span>{notice}</span><div className="notice-actions">{undo && <button type="button" className="notice-undo" onClick={undoDelete}>Undo</button>}<button className="icon-button notice-dismiss" aria-label="Dismiss message" onClick={dismissNotice}>×</button></div></div>}
      <section className="collection" aria-labelledby="collection-title">
        <div className="collection-head"><div><p className="eyebrow">{productConfig.collectionLabel}</p><h2 id="collection-title">All {productConfig.entityNamePlural}</h2><span className="result-count">{visible.length === records.length ? `${records.length} ${records.length === 1 ? productConfig.entityName : productConfig.entityNamePlural}` : `${visible.length} of ${records.length} shown`}</span>{summaries.length > 0 && <div className="metrics" aria-label="Summary">{summaries.map((summary) => <span key={summary.id}><strong>{summary.value}</strong> {summary.label}</span>)}</div>}</div>
          <div className="tools">
            {(query || filter !== "all") && <button type="button" className="clear-view" onClick={() => { setQuery(""); setFilter("all"); }}>Clear</button>}
            {productConfig.capabilities.search && <label className="search"><span className="sr-only">Search {productConfig.entityNamePlural}</span><input type="search" placeholder={`Search ${productConfig.entityNamePlural}…`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
            {productConfig.filters.length > 0 && <label><span className="sr-only">Filter {productConfig.entityNamePlural}</span><select aria-label={`Filter ${productConfig.entityNamePlural}`} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All {productConfig.entityNamePlural}</option>{productConfig.filters.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>}
            {productConfig.capabilities.sort && <label><span className="sr-only">Sort {productConfig.entityNamePlural}</span><select aria-label={`Sort ${productConfig.entityNamePlural}`} value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">Recently updated</option><option value="title">By name</option><option value="created">Oldest first</option></select></label>}
          </div>
        </div>
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
      <div className="form-grid">{productConfig.fields.filter((field) => isFieldVisible(field, values)).map((field) => <Field key={field.key} field={field} value={values[field.key]} error={errors[field.key]} onChange={(value) => updateValue(field.key, value)} />)}</div>
      <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" type="submit">{editingId ? "Save changes" : `Add ${productConfig.entityName}`}</button></div></form></dialog>
  </div>;
}
