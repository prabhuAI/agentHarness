import { FormEvent, useMemo, useRef, useState } from "react";
import { type EntityConfig, type FieldConfig, productConfig, type StandingsConfig } from "./product-config.js";
import { createRepository, type EntityRecord, type RecordValue } from "./repository.js";
import { evaluateRangeConflict } from "./range-conflicts.js";

type Values = Record<string, RecordValue>;
type RecordsByEntity = Record<string, EntityRecord[]>;

export interface StandingRow {
  id: string;
  label: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scoreFor: number;
  scoreAgainst: number;
  difference: number;
  points: number;
}

/** Pure standings engine shared by the UI and acceptance tests. */
export function computeStandings(
  table: StandingsConfig,
  rowEntity: EntityConfig,
  rowRecords: ReadonlyArray<EntityRecord>,
  sourceRecords: ReadonlyArray<EntityRecord>,
): StandingRow[] {
  const rows = new Map(rowRecords.map((record) => [record.id, {
    id: record.id,
    label: String(record.values[rowEntity.primaryField] ?? "Unnamed"),
    played: 0, won: 0, drawn: 0, lost: 0, scoreFor: 0, scoreAgainst: 0, difference: 0, points: 0,
  }]));
  for (const record of sourceRecords) {
    for (const participant of table.participants) {
      const id = String(record.values[participant.entityField] ?? "");
      const row = rows.get(id);
      const scoreForText = String(record.values[participant.scoreForField] ?? "").trim();
      const scoreAgainstText = String(record.values[participant.scoreAgainstField] ?? "").trim();
      const scoreFor = Number(scoreForText);
      const scoreAgainst = Number(scoreAgainstText);
      if (!row || scoreForText === "" || scoreAgainstText === "" || !Number.isFinite(scoreFor) || !Number.isFinite(scoreAgainst)) continue;
      row.played += 1;
      row.scoreFor += scoreFor;
      row.scoreAgainst += scoreAgainst;
      if (scoreFor > scoreAgainst) { row.won += 1; row.points += table.points.win; }
      else if (scoreFor === scoreAgainst) { row.drawn += 1; row.points += table.points.draw; }
      else { row.lost += 1; row.points += table.points.loss; }
      row.difference = row.scoreFor - row.scoreAgainst;
    }
  }
  return [...rows.values()].sort((left, right) =>
    right.points - left.points || right.difference - left.difference || right.scoreFor - left.scoreFor || left.label.localeCompare(right.label));
}

const emptyValues = (entity: EntityConfig): Values => Object.fromEntries(entity.fields.filter((field) => !field.derive).map((field) => [field.key, field.type === "boolean" ? false : ""]));
const labelFor = (entity: EntityConfig): string => entity.name.charAt(0).toUpperCase() + entity.name.slice(1);
const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

export function RelatedWorkspace({ primaryRecords }: { primaryRecords: EntityRecord[] }) {
  const entities = productConfig.entities ?? [];
  const related = entities.slice(1);
  const repositories = useMemo(() => Object.fromEntries(related.map((entity) => [entity.name, createRepository(`${productConfig.name}:${entity.name}`).repository])), []);
  const [recordsByEntity, setRecordsByEntity] = useState<RecordsByEntity>(() => Object.fromEntries(related.map((entity) => [entity.name, repositories[entity.name]!.list()])));
  const [editing, setEditing] = useState<{ entity: EntityConfig; id?: string }>();
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  if (related.length === 0) return null;
  const recordsFor = (name: string) => name === entities[0]?.name ? primaryRecords : (recordsByEntity[name] ?? []);
  const entityFor = (name: string) => entities.find((entity) => entity.name === name);
  const referenceFor = (entityName: string, fieldKey: string) => (productConfig.standings ?? [])
    .find((table) => table.sourceEntity === entityName && table.participants.some((participant) => participant.entityField === fieldKey));
  // The entity a field links to: an explicit `reference` field's target, or the
  // row entity of a standings participant. Both store a linked record's id and
  // render as that record's primary-field label / a picker of its records.
  const linkTargetName = (entity: EntityConfig, fieldKey: string): string | undefined => {
    const field = entity.fields.find((candidate) => candidate.key === fieldKey);
    if (field?.type === "reference" && field.refEntity) return field.refEntity;
    return referenceFor(entity.name, fieldKey)?.rowEntity;
  };
  const displayRecordValue = (entity: EntityConfig, fieldKey: string, value: RecordValue | undefined): string => {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    const targetName = linkTargetName(entity, fieldKey);
    if (!targetName) return raw;
    const rowsEntity = entityFor(targetName);
    const linked = recordsFor(targetName).find((candidate) => candidate.id === raw);
    return rowsEntity && linked ? String(linked.values[rowsEntity.primaryField] ?? "Unnamed") : "Unknown record";
  };
  const recordTitle = (entity: EntityConfig, record: EntityRecord): string => {
    const table = (productConfig.standings ?? []).find((candidate) => candidate.sourceEntity === entity.name);
    if (table) {
      const participants = table.participants.map((participant) => displayRecordValue(entity, participant.entityField, record.values[participant.entityField]));
      if (participants.every((participant) => participant !== "—" && participant !== "Unknown record")) return participants.join(" vs ");
    }
    return displayRecordValue(entity, entity.primaryField, record.values[entity.primaryField]);
  };
  const rangeEvaluations = editing ? (editing.entity.rangeConflicts ?? []).map((rule) => ({
    rule,
    evaluation: evaluateRangeConflict(rule, values, recordsFor(editing.entity.name), editing.id),
  })) : [];

  const open = (entity: EntityConfig, record?: EntityRecord) => {
    setEditing({ entity, id: record?.id });
    setValues({ ...emptyValues(entity), ...(record?.values ?? {}) });
    setErrors({});
    dialog.current?.showModal();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const nextErrors: Record<string, string> = {};
    for (const field of editing.entity.fields) {
      const value = values[field.key];
      if (field.required && (String(value ?? "").trim() === "" || value === false)) nextErrors[field.key] = `${field.label} is required.`;
      if ((field.type === "number" || field.type === "currency") && String(value ?? "").trim() !== "") {
        const number = Number(value);
        if (!Number.isFinite(number)) nextErrors[field.key] = "Enter a valid number.";
        else if (field.min !== undefined && number < field.min) nextErrors[field.key] = `Must be at least ${field.min}.`;
        else if (field.max !== undefined && number > field.max) nextErrors[field.key] = `Must be at most ${field.max}.`;
      }
    }
    const table = (productConfig.standings ?? []).find((candidate) => candidate.sourceEntity === editing.entity.name);
    if (table) {
      const [left, right] = table.participants;
      if (values[left.entityField] && values[left.entityField] === values[right.entityField]) nextErrors[right.entityField] = "Choose two different participants.";
    }
    for (const { rule, evaluation } of rangeEvaluations) {
      if (evaluation.invalidOrder) nextErrors[rule.endField] = "End must be on or after start.";
      else if (evaluation.conflicts.length > 0) nextErrors[rule.matchField] = "Unavailable for this period. Choose different dates or another item.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const repository = repositories[editing.entity.name]!;
    try {
      if (editing.id) repository.update(editing.id, values); else repository.create(values);
      setRecordsByEntity((current) => ({ ...current, [editing.entity.name]: repository.list() }));
      setNotice(`${labelFor(editing.entity)} ${editing.id ? "updated" : "added"}.`);
      dialog.current?.close();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The change could not be saved."); }
  };

  const remove = (entity: EntityConfig, record: EntityRecord) => {
    const repository = repositories[entity.name]!;
    try {
      repository.remove(record.id);
      setRecordsByEntity((current) => ({ ...current, [entity.name]: repository.list() }));
      setNotice(`${labelFor(entity)} deleted.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The item could not be deleted."); }
  };

  const renderField = (entity: EntityConfig, field: FieldConfig) => {
    const id = `related-${entity.name}-${field.key}`;
    const value = values[field.key] ?? (field.type === "boolean" ? false : "");
    const targetName = linkTargetName(entity, field.key);
    let control;
    if (targetName) {
      const rowsEntity = entityFor(targetName)!;
      const options = recordsFor(targetName);
      control = <select id={id} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>
        <option value="">Choose {field.label.toLowerCase()}</option>
        {options.map((record) => <option key={record.id} value={record.id}>{String(record.values[rowsEntity.primaryField] ?? "Unnamed")}</option>)}
      </select>;
    } else if (field.type === "boolean") {
      control = <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.checked }))} />;
    } else if ((field.type === "category" || field.type === "status") && field.options?.length) {
      control = <select id={id} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Choose {field.label.toLowerCase()}</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>;
    } else {
      const type = field.type === "number" || field.type === "currency" ? "number" : field.type === "datetime" ? "datetime-local" : field.type === "email" || field.type === "url" || field.type === "date" ? field.type : "text";
      control = field.type === "longText"
        ? <textarea id={id} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
        : <input id={id} type={type} min={field.min} max={field.max} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />;
    }
    return <div className="field" key={field.key}><label htmlFor={id}>{field.label}{field.required && " *"}</label>{control}{errors[field.key] && <small className="error">{errors[field.key]}</small>}</div>;
  };

  return <section className="related-workspace" aria-label="Related records and standings">
    {(productConfig.standings ?? []).map((table) => {
      const rowEntity = entityFor(table.rowEntity);
      if (!rowEntity) return null;
      const rows = computeStandings(table, rowEntity, recordsFor(table.rowEntity), recordsFor(table.sourceEntity));
      return <section className="standings-panel" key={table.id} aria-labelledby={`standings-${table.id}`}>
        <div className="section-heading"><div><p className="eyebrow">Live ranking</p><h2 id={`standings-${table.id}`}>{table.label}</h2></div><span>{rows.length} {rowEntity.plural}</span></div>
        {rows.length === 0 ? <p className="related-empty">Add {rowEntity.plural}, then add {entityFor(table.sourceEntity)?.plural ?? "scored records"} to calculate the standings.</p> : <div className="table-scroll"><table><thead><tr><th scope="col">#</th><th scope="col">{labelFor(rowEntity)}</th><th scope="col"><abbr title="Played">P</abbr></th><th scope="col"><abbr title="Won">W</abbr></th><th scope="col"><abbr title="Drawn">D</abbr></th><th scope="col"><abbr title="Lost">L</abbr></th><th scope="col"><abbr title="Score for">For</abbr></th><th scope="col"><abbr title="Score against">Against</abbr></th><th scope="col"><abbr title="Difference">+/-</abbr></th><th scope="col"><abbr title="Points">Pts</abbr></th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><th scope="row">{row.label}</th><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.scoreFor}</td><td>{row.scoreAgainst}</td><td>{row.difference > 0 ? `+${row.difference}` : row.difference}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></div>}
      </section>;
    })}
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="related-grid">{related.map((entity) => <section className="related-panel" key={entity.name} aria-labelledby={`related-${entity.name}`}>
      <div className="section-heading"><div><p className="eyebrow">Manage records</p><h2 id={`related-${entity.name}`}>{capitalize(entity.plural)}</h2></div><div className="section-heading-actions"><span>{recordsByEntity[entity.name]?.length ?? 0} {entity.plural}</span><button className="primary" type="button" onClick={() => open(entity)}>+ Add {entity.name}</button></div></div>
      {(recordsByEntity[entity.name] ?? []).length === 0 ? <p className="related-empty">No {entity.plural} yet.</p> : <div className="grid">{recordsByEntity[entity.name]!.map((record) => <article className="card" key={record.id}>
        <div className="card-top"><h3>{recordTitle(entity, record)}</h3><div className="actions"><button type="button" onClick={() => open(entity, record)}>Edit</button><button type="button" className="danger" onClick={() => remove(entity, record)}>Delete</button></div></div>
        <dl>{entity.secondaryFields.map((key) => { const field = entity.fields.find((candidate) => candidate.key === key); if (!field) return null; return <div key={key}><dt>{field.label}</dt><dd>{displayRecordValue(entity, key, record.values[key])}</dd></div>; })}</dl>
      </article>)}</div>}
    </section>)}</div>
    <dialog ref={dialog}><form onSubmit={submit} noValidate><div className="dialog-head"><div><p className="eyebrow">{editing?.id ? "Update" : "New entry"}</p><h2>{editing ? `${editing.id ? "Edit" : "Add"} ${editing.entity.name}` : "Add record"}</h2></div><button type="button" className="icon-button" aria-label="Close related record" onClick={() => dialog.current?.close()}>×</button></div>
      <div className="form-grid">{editing?.entity.fields.filter((field) => !field.derive).map((field) => renderField(editing.entity, field))}</div>
      {rangeEvaluations.map(({ rule, evaluation }) => !evaluation.ready || evaluation.invalidOrder ? null : evaluation.conflicts.length === 0
        ? <div className="availability availability-free" role="status" key={rule.id}>Available for this period.</div>
        : <div className="availability availability-conflict" role="alert" key={rule.id}><strong>Unavailable for this period.</strong><span>Conflicts with {evaluation.conflicts.length} existing record{evaluation.conflicts.length === 1 ? "" : "s"}.</span></div>)}
      <div className="dialog-actions"><button type="button" className="secondary" onClick={() => dialog.current?.close()}>Cancel</button><button type="submit" className="primary">{editing?.id ? "Save changes" : `Add ${editing?.entity.name ?? "record"}`}</button></div>
    </form></dialog>
  </section>;
}
