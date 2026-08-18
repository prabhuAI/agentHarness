import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FieldConfig, type PredicateOperator, productConfig } from "./product-config.js";
import { EntityRecord, LocalStorageRepository, RecordValue } from "./repository.js";

const storageKey = `agent-cofounder:${productConfig.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:v1`;
const loaded = LocalStorageRepository.load(storageKey);
const repository = new LocalStorageRepository(storageKey, loaded.records, typeof window === "undefined" ? undefined : window.localStorage);

type Values = Record<string, RecordValue>;
type Errors = Record<string, string>;

const emptyValues = (): Values => Object.fromEntries(
  productConfig.fields.map((field) => [field.key, field.type === "boolean" ? false : ""]),
);

function validate(values: Values): Errors {
  const errors: Errors = {};
  for (const field of productConfig.fields) {
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
  const common = { id, name: field.key, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined };
  let control;
  if (field.type === "longText") {
    control = <textarea {...common} rows={4} value={String(value)} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  } else if ((field.type === "category" || field.type === "status") && field.options && !field.allowCustom) {
    control = <select {...common} value={String(value)} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose {field.label.toLowerCase()}</option>
      {field.options.map((option) => <option key={option}>{option}</option>)}
    </select>;
  } else if (field.type === "boolean") {
    control = <label className="check"><input {...common} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span>Yes</span></label>;
  } else {
    const inputType = field.type === "currency" || field.type === "number" ? "number" : field.type === "datetime" ? "datetime-local" : field.type === "category" || field.type === "status" ? "text" : field.type;
    control = <><input {...common} type={inputType} value={String(value)} min={field.min} max={field.max} placeholder={field.placeholder} list={field.allowCustom ? `${id}-options` : undefined} onChange={(event) => onChange(event.target.value)} />
      {field.allowCustom && field.options && <datalist id={`${id}-options`}>{field.options.map((option) => <option key={option} value={option} />)}</datalist>}</>;
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

export function App() {
  const [records, setRecords] = useState<EntityRecord[]>(repository.list());
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  const [editingId, setEditingId] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("updated");
  const [notice, setNotice] = useState(loaded.recoveredFromInvalidData ? "Saved data was damaged, so a clean workspace was restored." : "");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { document.title = productConfig.name; }, []);

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
  const summaries = useMemo(() => productConfig.summaries.slice(0, 3).map((summary) => {
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      if (editingId) repository.update(editingId, values); else repository.create(values);
      setRecords(repository.list());
      setNotice(`${productConfig.entityName[0].toUpperCase()}${productConfig.entityName.slice(1)} ${editingId ? "updated" : "added"}.`);
      close();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The change could not be saved."); }
  };

  const remove = (record: EntityRecord) => {
    const label = String(record.values[productConfig.primaryField] ?? productConfig.entityName);
    if (!globalThis.confirm(`Delete “${label}”? This cannot be undone.`)) return;
    try { repository.remove(record.id); setRecords(repository.list()); setNotice(`${productConfig.entityName[0].toUpperCase()}${productConfig.entityName.slice(1)} deleted.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "The item could not be deleted."); }
  };

  const recordCard = (record: EntityRecord) => <article className="card" key={record.id}>
    <div className="card-top"><h3>{displayValue(productConfig.fields.find((field) => field.key === productConfig.primaryField)!, record.values[productConfig.primaryField])}</h3>
      <div className="actions">{productConfig.capabilities.edit && <button onClick={() => openEdit(record)}>Edit</button>}{productConfig.capabilities.delete && <button className="danger" onClick={() => remove(record)}>Delete</button>}</div></div>
    <dl>{productConfig.secondaryFields.map((key) => { const field = productConfig.fields.find((candidate) => candidate.key === key); return field ? <div key={key}><dt>{field.label}</dt><dd className={field.type === "status" ? "badge" : ""}>{displayValue(field, record.values[key])}</dd></div> : null; })}</dl>
  </article>;

  return <div className="app" style={{ "--accent": productConfig.accent } as React.CSSProperties}>
    <header className="topbar"><a className="brand" href="#main"><span className="brand-mark">AC</span><span>{productConfig.name}</span></a><span className="local-pill">Private · saved locally</span></header>
    <main id="main">
      <section className="hero">
        <div><p className="eyebrow">Your working space</p><h1>{productConfig.name}</h1><p>{productConfig.tagline}</p></div>
        {productConfig.capabilities.create && <button className="primary" onClick={openCreate}>+ Add {productConfig.entityName}</button>}
      </section>
      <section className="stats" aria-label="Overview">
        {summaries.map((summary) => <div key={summary.id}><strong>{summary.value}</strong><span>{summary.label}</span></div>)}
        {summaries.length < 3 && <div><strong>{visible.length}</strong><span>In current view</span></div>}
        {summaries.length < 2 && <div><strong>{records.length ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(records[0].updatedAt)) : "—"}</strong><span>Last updated</span></div>}
      </section>
      {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
      <section className="collection" aria-labelledby="collection-title">
        <div className="collection-head"><div><p className="eyebrow">{productConfig.collectionLabel}</p><h2 id="collection-title">All {productConfig.entityNamePlural}</h2></div>
          <div className="tools">
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
      <div className="form-grid">{productConfig.fields.map((field) => <Field key={field.key} field={field} value={values[field.key]} error={errors[field.key]} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />)}</div>
      <div className="dialog-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" type="submit">{editingId ? "Save changes" : `Add ${productConfig.entityName}`}</button></div></form></dialog>
  </div>;
}
