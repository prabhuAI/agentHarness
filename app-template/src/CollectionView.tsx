import { Fragment, type ReactNode } from "react";
import { productConfig, type PrimaryView } from "./product-config.js";
import type { EntityRecord } from "./repository.js";

interface CollectionViewProps {
  records: EntityRecord[];
  renderRecord: (record: EntityRecord, view: PrimaryView) => ReactNode;
}

interface RecordGroup { label: string; records: EntityRecord[] }

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "other";
}

export function groupRecords(records: EntityRecord[], fieldKey: string | undefined, emptyLabel: string): RecordGroup[] {
  if (!fieldKey) return [{ label: emptyLabel, records }];
  const groups = new Map<string, EntityRecord[]>();
  for (const record of records) {
    const label = String(record.values[fieldKey] ?? "").trim() || emptyLabel;
    groups.set(label, [...(groups.get(label) ?? []), record]);
  }
  return [...groups.entries()].map(([label, grouped]) => ({ label, records: grouped }));
}

function TrackerView({ records, renderRecord }: CollectionViewProps) {
  return <ol className="tracker-view" aria-label={`${productConfig.entityNamePlural} progress list`}>
    {records.map((record) => <li key={record.id}>{renderRecord(record, "tracker")}</li>)}
  </ol>;
}

function TableView({ records, renderRecord }: CollectionViewProps) {
  // The main app renders the table view as a real <table> (see App.tsx). This
  // stays as a structural fallback for grouped-table sections.
  return <div className="table-view" aria-label={`${productConfig.entityNamePlural} table`}>
    <div>{records.map((record) => <div className="table-view-row" key={record.id}>{renderRecord(record, "table")}</div>)}</div>
  </div>;
}

function BoardView({ records, renderRecord }: CollectionViewProps) {
  const groups = groupRecords(records, productConfig.presentation.groupField, "Uncategorized");
  return <div className="board-view" aria-label={`${productConfig.entityNamePlural} board`}>
    {groups.map((group) => <section className="board-column" key={group.label} aria-labelledby={`group-${slug(group.label)}`}>
      <div className="board-column-heading"><h3 id={`group-${slug(group.label)}`}>{group.label}</h3><span>{group.records.length}</span></div>
      <div className="board-column-records">{group.records.map((record) => <Fragment key={record.id}>{renderRecord(record, "board")}</Fragment>)}</div>
    </section>)}
  </div>;
}

function AgendaView({ records, renderRecord }: CollectionViewProps) {
  const groups = groupRecords(records, productConfig.presentation.dateField, "Unscheduled");
  return <div className="agenda-view" aria-label={`${productConfig.entityNamePlural} agenda`}>
    {groups.map((group) => <section className="agenda-day" key={group.label} aria-labelledby={`date-${slug(group.label)}`}>
      <header><time id={`date-${slug(group.label)}`} dateTime={group.label === "Unscheduled" ? undefined : group.label}>{group.label}</time><span>{group.records.length}</span></header>
      <div className="agenda-day-records">{group.records.map((record) => <Fragment key={record.id}>{renderRecord(record, "agenda")}</Fragment>)}</div>
    </section>)}
  </div>;
}

function GalleryView({ records, renderRecord }: CollectionViewProps) {
  return <div className="gallery-view" aria-label={`${productConfig.entityNamePlural} gallery`}>
    {records.map((record, index) => <div className="gallery-item" key={record.id}><div className="gallery-cover" aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span></div>{renderRecord(record, "gallery")}</div>)}
  </div>;
}

function DashboardView({ records, renderRecord, grouped }: CollectionViewProps & { grouped?: boolean }) {
  return <div className="dashboard-view" aria-label={`${productConfig.entityNamePlural} monitoring list`}>
    {/* When wrapped in a collection group the section already has its own heading
        and count, so the inner "Live records" strip would just stack a second
        redundant heading. Show it only when the dashboard is the top-level view. */}
    {!grouped && <div className="dashboard-view-heading"><strong>Live records</strong><span>{records.length} tracked</span></div>}
    <div className="dashboard-view-records">{records.map((record) => <Fragment key={record.id}>{renderRecord(record, "dashboard")}</Fragment>)}</div>
  </div>;
}

function StandingsRosterView({ records, renderRecord }: CollectionViewProps) {
  return <div className="standings-roster" aria-label={`${productConfig.entityNamePlural} roster`}>
    {records.map((record) => <Fragment key={record.id}>{renderRecord(record, "standings")}</Fragment>)}
  </div>;
}

function PrimaryCollection(props: CollectionViewProps & { grouped?: boolean }) {
  const primary = productConfig.presentation.primary;
  if (primary === "board") return <BoardView {...props} />;
  if (primary === "agenda") return <AgendaView {...props} />;
  if (primary === "gallery") return <GalleryView {...props} />;
  if (primary === "dashboard") return <DashboardView {...props} />;
  if (primary === "table") return <TableView {...props} />;
  if (primary === "standings") return <StandingsRosterView {...props} />;
  return <TrackerView {...props} />;
}

export function CollectionView(props: CollectionViewProps) {
  const { primary, groupField } = productConfig.presentation;
  if (!groupField || primary === "board") return <PrimaryCollection {...props} />;
  const groups = groupRecords(props.records, groupField, "Uncategorized");
  const fieldLabel = productConfig.fields.find((field) => field.key === groupField)?.label ?? groupField;
  return <div className="grouped-collection" role="region" aria-label={`${productConfig.entityNamePlural} grouped by ${fieldLabel}`}>
    {groups.map((group) => <section className="collection-group" key={group.label} aria-labelledby={`group-${slug(group.label)}`}>
      <div className="collection-group-heading"><h3 id={`group-${slug(group.label)}`}>{group.label}</h3><span>{group.records.length}</span></div>
      <PrimaryCollection {...props} records={group.records} grouped />
    </section>)}
  </div>;
}
