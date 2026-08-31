// Demo/observability layer: turns the audited trace.jsonl + result.json a run
// already produces into (a) a narrated console timeline and (b) a self-contained
// HTML run report. This module is PURE — it only reads what the scored pipeline
// wrote and returns strings. It never mutates state, telemetry, or exit codes,
// so importing or rendering can never change a scored outcome.

export interface TraceEventLike {
  step: number;
  timestamp: string;
  agent: string;
  action: string;
  status: string;
  [key: string]: unknown;
}

export interface ResultLike {
  status?: string;
  summary?: string;
  app_url?: string;
  start_command?: string;
  model_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_tokens?: number;
  weighted_token_expenditure?: number;
  telemetry_source?: string;
  implemented_features?: string[];
  assumptions?: string[];
  tests_run?: Array<{ command?: string; journey?: string; result?: string }>;
  harness_checks?: Array<{ command?: string; journey?: string; result?: string }>;
  [key: string]: unknown;
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);
const cap = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** Parse a trace.jsonl body into ordered events, tolerating blank/partial lines. */
export function parseTrace(content: string): TraceEventLike[] {
  const events: TraceEventLike[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof value.action === "string" && typeof value.agent === "string") {
        events.push(value as unknown as TraceEventLike);
      }
    } catch {
      // A malformed line is skipped; the report is best-effort, never fatal.
    }
  }
  return events;
}

const STAGE_ICON: Record<string, string> = {
  product: "🧠",
  router: "🧭",
  compiler: "🔨",
  qa: "🧪",
  repair: "🩹",
  delivery: "📦",
};

const STATUS_MARK: Record<string, string> = {
  success: "✓",
  started: "…",
  failed: "✗",
  skipped: "–",
};

/**
 * Human sentence for one trace step. Reads only fields the compiler already
 * records, so new trace keys degrade gracefully to a generic line.
 */
export function describeStep(event: TraceEventLike): string {
  const genome = str(event.genome);
  const strategy = str(event.strategy);
  switch (`${event.agent}:${event.action}`) {
    case "product:interpret_idea": {
      const entities = num(event.entities);
      const g = genome ? ` — genome detected: ${genome}` : "";
      return `Model call → idea interpreted into Product IR${g}, ${entities} entit${entities === 1 ? "y" : "ies"}`;
    }
    case "product:select_scope":
      return `Scope chosen → ${num(event.included)} feature${num(event.included) === 1 ? "" : "s"} in, ${num(event.excluded)} deliberately excluded`;
    case "router:select_strategy": {
      const route = strategy === "compile"
        ? "compile (deterministic route — 0 extra model calls)"
        : strategy === "hybrid"
          ? "hybrid (deterministic base + focused patch)"
          : strategy === "custom"
            ? "custom (bounded model-authored feature)"
            : strategy ?? "unknown";
      const budget = event.budget as Record<string, unknown> | undefined;
      const state = budget ? str(budget.state) : undefined;
      return `Route selected → ${route}${state ? ` · budget ${state}` : ""}`;
    }
    case "compiler:generate_application": {
      const g = genome ? `${genome} genome` : "application";
      return `Compiling → ${g} built deterministically from the IR (${num(event.fields)} field${num(event.fields) === 1 ? "" : "s"})`;
    }
    case "compiler:generate_custom_feature":
      return `Custom feature → model authored a focused component patch`;
    case "qa:verify_journeys": {
      const passed = num(event.passed);
      const failed = num(event.failed);
      return `QA → ${passed}/${passed + failed} derived user journeys passed`;
    }
    case "repair:deterministic_repair":
      return `Repair → deterministic fix applied (no model call)`;
    case "repair:llm_repair":
      return `Repair → targeted model patch applied`;
    case "delivery:finalize": {
      const artifacts = event.artifacts as Record<string, unknown> | undefined;
      const count = artifacts ? Object.keys(artifacts).length : 0;
      return `Delivery → verified app finalized, ${count} audit artifact${count === 1 ? "" : "s"} written`;
    }
    default:
      return `${cap(event.agent)} → ${event.action.replaceAll("_", " ")}`;
  }
}

/** Narrated, emoji-marked console timeline for a completed run. */
export function narrateTraceLines(events: TraceEventLike[]): string[] {
  return events.map((event) => {
    const icon = STAGE_ICON[event.agent] ?? "•";
    const mark = STATUS_MARK[event.status] ?? "";
    const step = String(event.step ?? "?").padStart(2, " ");
    return `  ${icon}  [${step}] ${describeStep(event)} ${mark}`.trimEnd();
  });
}

function fmt(value: number): string {
  return value.toLocaleString("en-US");
}

/** Boxed token/telemetry summary for the console. */
export function tokenSummaryLines(result: ResultLike): string[] {
  const rows: Array<[string, string]> = [
    ["Status", (result.status ?? "unknown").toUpperCase()],
    ["Model calls", fmt(num(result.model_calls))],
    ["Input tokens", fmt(num(result.input_tokens))],
    ["Output tokens", `${fmt(num(result.output_tokens))}   (weighted ×3)`],
    ["Cache read tokens", `${fmt(num(result.cache_read_tokens))}   (weighted ×0.1)`],
    ["Total tokens", fmt(num(result.total_tokens))],
    ["Weighted expenditure", num(result.weighted_token_expenditure).toLocaleString("en-US", { maximumFractionDigits: 1 })],
    ["App URL", result.app_url ?? "http://localhost:3000"],
  ];
  const width = Math.max(...rows.map(([label, value]) => label.length + value.length)) + 6;
  const line = "─".repeat(width);
  const out = [`┌${line}┐`];
  for (const [label, value] of rows) {
    const gap = width - label.length - value.length - 2;
    out.push(`│ ${label}${" ".repeat(Math.max(gap, 1))}${value} │`);
  }
  out.push(`└${line}┘`);
  return out;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Self-contained (no external assets) HTML run report. Theme-aware, responsive,
 * safe to open directly from disk or publish as an Artifact.
 */
export function renderHtmlReport(input: { idea: string; events: TraceEventLike[]; result: ResultLike }): string {
  const { idea, events, result } = input;
  const weighted = num(result.weighted_token_expenditure);
  const journeys = (result.tests_run ?? []).filter((entry) => entry.result === "passed").length;
  const journeyTotal = (result.tests_run ?? []).length;
  const genome = str(events.find((event) => str(event.genome))?.genome) ?? "—";
  const strategy = str(events.find((event) => event.action === "select_strategy")?.strategy) ?? "—";

  const stat = (label: string, value: string, hint = ""): string =>
    `<div class="stat"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div>${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ""}</div>`;

  const timeline = events
    .map((event) => {
      const icon = STAGE_ICON[event.agent] ?? "•";
      const ok = event.status === "success";
      return `<li class="step ${ok ? "ok" : esc(event.status)}"><span class="dot">${icon}</span><div><div class="step-title">${esc(describeStep(event))}</div><div class="step-meta">${esc(cap(event.agent))} · ${esc(event.action)} · ${esc(event.status)}</div></div></li>`;
    })
    .join("\n");

  const list = (items: string[]): string =>
    items.length ? `<ul class="chips">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p class="muted">None</p>`;

  const checkRows = [...(result.tests_run ?? []), ...(result.harness_checks ?? [])]
    .map((entry) => `<tr><td class="${entry.result === "passed" ? "pass" : "fail"}">${entry.result === "passed" ? "✓" : "✗"}</td><td>${esc(entry.journey ?? "")}</td><td class="mono">${esc(entry.command ?? "")}</td></tr>`)
    .join("\n");

  return `<title>CompileKit — Run Report</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --ink:#111826; --muted:#5b6572; --line:#e4e7ec; --accent:#2f6df6; --ok:#12855b; --fail:#c0392b; --chip:#eef2ff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --card:#161b22; --ink:#e6edf3; --muted:#8b949e; --line:#232a33; --accent:#589bff; --ok:#3fb950; --fail:#f85149; --chip:#1b2436; } }
  :root[data-theme="dark"] { --bg:#0d1117; --card:#161b22; --ink:#e6edf3; --muted:#8b949e; --line:#232a33; --accent:#589bff; --ok:#3fb950; --fail:#f85149; --chip:#1b2436; }
  :root[data-theme="light"] { --bg:#f6f7f9; --card:#fff; --ink:#111826; --muted:#5b6572; --line:#e4e7ec; --accent:#2f6df6; --ok:#12855b; --fail:#c0392b; --chip:#eef2ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:960px; margin:0 auto; padding:32px 20px 64px; }
  header h1 { margin:0 0 4px; font-size:24px; letter-spacing:-.02em; }
  header p { margin:0; color:var(--muted); }
  .idea { margin:20px 0; padding:14px 16px; background:var(--card); border:1px solid var(--line); border-radius:12px; color:var(--muted); font-style:italic; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:20px 0; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .stat-value { font-size:26px; font-weight:650; letter-spacing:-.02em; }
  .stat-label { color:var(--muted); font-size:13px; margin-top:2px; }
  .stat-hint { color:var(--muted); font-size:11px; margin-top:4px; opacity:.8; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:32px 0 12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:6px 18px; }
  ol.timeline { list-style:none; margin:0; padding:0; }
  .step { display:flex; gap:14px; padding:14px 0; border-bottom:1px solid var(--line); align-items:flex-start; }
  .step:last-child { border-bottom:0; }
  .dot { flex:none; width:34px; height:34px; border-radius:50%; background:var(--chip); display:grid; place-items:center; font-size:17px; }
  .step-title { font-weight:550; }
  .step-meta { color:var(--muted); font-size:12px; margin-top:2px; }
  .step.failed .step-title, .step.failed .step-meta { color:var(--fail); }
  .chips { list-style:none; display:flex; flex-wrap:wrap; gap:8px; padding:0; margin:0; }
  .chips li { background:var(--chip); border-radius:999px; padding:5px 12px; font-size:13px; }
  .muted { color:var(--muted); }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  @media (max-width:640px){ .cols { grid-template-columns:1fr; } }
  .tablewrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  td { padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.pass { color:var(--ok); font-weight:700; width:24px; }
  td.fail { color:var(--fail); font-weight:700; width:24px; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--muted); font-size:12px; }
  a { color:var(--accent); }
  footer { margin-top:40px; color:var(--muted); font-size:12px; }
</style>
<div class="wrap">
  <header>
    <h1>CompileKit — Run Report</h1>
    <p>Idea → Product IR → deterministic compile → verified app. All figures below are read from the run's audited <span class="mono">trace.jsonl</span> and <span class="mono">result.json</span>.</p>
  </header>
  <div class="idea">“${esc(idea.trim())}”</div>
  <div class="grid">
    ${stat("Genome", genome)}
    ${stat("Route", strategy, strategy === "compile" ? "0 extra model calls" : "")}
    ${stat("Model calls", fmt(num(result.model_calls)))}
    ${stat("Journeys passed", `${journeys}/${journeyTotal}`)}
    ${stat("Output tokens", fmt(num(result.output_tokens)), "weighted ×3")}
    ${stat("Weighted tokens", weighted.toLocaleString("en-US", { maximumFractionDigits: 1 }))}
  </div>
  <h2>What happened, in order</h2>
  <div class="card"><ol class="timeline">${timeline}</ol></div>
  <div class="cols">
    <div><h2>Implemented</h2>${list(result.implemented_features ?? [])}</div>
    <div><h2>Assumptions</h2>${list(result.assumptions ?? [])}</div>
  </div>
  <h2>Verification</h2>
  <div class="card tablewrap"><table><tbody>${checkRows}</tbody></table></div>
  <footer>Status: <strong>${esc((result.status ?? "unknown").toUpperCase())}</strong> · telemetry source: ${esc(result.telemetry_source ?? "audited events")} · start with <span class="mono">${esc(result.start_command ?? "npm run dev")}</span> → <a href="${esc(result.app_url ?? "http://localhost:3000")}">${esc(result.app_url ?? "http://localhost:3000")}</a></footer>
</div>`;
}
