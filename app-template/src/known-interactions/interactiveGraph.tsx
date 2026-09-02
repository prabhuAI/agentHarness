import { useEffect, useMemo, useRef, useState } from "react";
import { customStateRepository, primaryRecordLabel, type CustomFeatureProps } from "../custom-feature-api.js";

type Point = { x: number; y: number };
type GraphState = { positions: Record<string, Point>; edges: Array<[string, string]> };
const EMPTY: GraphState = { positions: {}, edges: [] };

export default function InteractiveGraph({ records, onSelectRecord }: CustomFeatureProps) {
  const repository = useMemo(() => customStateRepository("interactive-graph"), []);
  const [graph, setGraph] = useState<GraphState>(() => {
    try { return JSON.parse(String(repository.list()[0]?.values.data ?? "")) as GraphState; } catch { return EMPTY; }
  });
  const [drag, setDrag] = useState<{ id: string; offset: Point } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const surface = useRef<HTMLDivElement>(null);
  const latestGraph = useRef(graph);

  const save = (next: GraphState) => {
    const data = JSON.stringify(next);
    const stored = repository.list()[0];
    if (stored) repository.update(stored.id, { data }); else repository.create({ data });
    latestGraph.current = next;
    setGraph(next);
  };

  useEffect(() => {
    const ids = new Set(records.map((record) => record.id));
    const positions = Object.fromEntries(Object.entries(graph.positions).filter(([id]) => ids.has(id)));
    records.forEach((record, index) => {
      positions[record.id] ??= { x: 32 + (index % 4) * 210, y: 48 + Math.floor(index / 4) * 132 };
    });
    const edges = graph.edges.filter(([from, to]) => ids.has(from) && ids.has(to));
    const next = { positions, edges };
    if (JSON.stringify(next) !== JSON.stringify(graph)) save(next);
  }, [records]);

  const point = (event: React.PointerEvent): Point => {
    const box = surface.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const move = (event: React.PointerEvent) => {
    const current = point(event);
    setCursor(current);
    if (!drag) return;
    setGraph((state) => { const next = { ...state, positions: { ...state.positions, [drag.id]: {
      x: Math.max(0, current.x - drag.offset.x), y: Math.max(0, current.y - drag.offset.y),
    } } }; latestGraph.current = next; return next; });
  };
  const finish = () => { if (drag) save(latestGraph.current); setDrag(null); setLinkFrom(null); };
  const startNodeDrag = (event: React.PointerEvent, id: string) => {
    if (linkFrom) return;
    const current = point(event); const position = graph.positions[id] ?? { x: 0, y: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, offset: { x: current.x - position.x, y: current.y - position.y } });
  };
  const connect = (event: React.PointerEvent, to: string) => {
    if (!linkFrom || linkFrom === to) return;
    event.stopPropagation();
    const key = `${linkFrom}:${to}`;
    const edges = graph.edges.some(([from, target]) => `${from}:${target}` === key)
      ? graph.edges : [...graph.edges, [linkFrom, to] as [string, string]];
    save({ ...graph, edges }); setLinkFrom(null);
  };
  const removeEdge = (from: string, to: string) => save({
    ...graph, edges: graph.edges.filter(([left, right]) => left !== from || right !== to),
  });

  if (records.length === 0) return <section aria-label="Dependency graph"><p>Add records to place nodes on the graph.</p></section>;
  return <section aria-label="Dependency graph" style={{ margin: "18px 0", padding: 16, border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <div><strong>Dependency graph</strong><div style={{ color: "var(--muted)", fontSize: 13 }}>Drag nodes to arrange them. Drag a node’s connector onto another node to create an arrow.</div></div>
      {linkFrom && <button onClick={() => setLinkFrom(null)}>Cancel connection</button>}
    </div>
    <div ref={surface} aria-label="Interactive node canvas" onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      style={{ position: "relative", height: 430, marginTop: 12, overflow: "auto", borderRadius: 12, background: "var(--surface-alt)", touchAction: "none" }}>
      <svg aria-label="Directed dependency arrows" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        <defs><marker id="dependency-arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="var(--accent)" /></marker></defs>
        {graph.edges.map(([from, to]) => {
          const start = graph.positions[from]; const end = graph.positions[to]; if (!start || !end) return null;
          return <line key={`${from}:${to}`} x1={start.x + 176} y1={start.y + 36} x2={end.x} y2={end.y + 36}
            stroke="var(--accent)" strokeWidth="3" markerEnd="url(#dependency-arrowhead)" style={{ pointerEvents: "stroke", cursor: "pointer" }}
            onClick={() => removeEdge(from, to)}><title>Delete dependency arrow</title></line>;
        })}
        {linkFrom && graph.positions[linkFrom] && <line x1={graph.positions[linkFrom].x + 176} y1={graph.positions[linkFrom].y + 36}
          x2={cursor.x} y2={cursor.y} stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" markerEnd="url(#dependency-arrowhead)" />}
      </svg>
      {records.map((record) => {
        const position = graph.positions[record.id] ?? { x: 0, y: 0 }; const label = primaryRecordLabel(record);
        return <article key={record.id} onPointerDown={(event) => startNodeDrag(event, record.id)} onPointerUp={(event) => connect(event, record.id)} onDoubleClick={() => onSelectRecord(record.id)}
          style={{ position: "absolute", left: position.x, top: position.y, width: 176, minHeight: 72, padding: 12, border: "2px solid var(--border)", borderRadius: 12, background: "var(--surface)", boxShadow: "0 6px 20px rgb(0 0 0 / .09)", cursor: drag?.id === record.id ? "grabbing" : "grab", userSelect: "none" }}>
          <strong>{label}</strong><div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>Double-click to open</div>
          <button aria-label={`Start dependency from ${label}`} onPointerDown={(event) => { event.stopPropagation(); setLinkFrom(record.id); setCursor(point(event)); }}
            style={{ position: "absolute", right: -11, top: 24, width: 22, height: 22, padding: 0, borderRadius: 99, border: "3px solid var(--surface)", background: "var(--accent)", color: "var(--accent-text)" }}>+</button>
        </article>;
      })}
    </div>
  </section>;
}
