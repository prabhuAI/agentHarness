// watch-sweep.mjs — live, color-coded monitor for scripts/run-comparison.sh.
// Read-only: polls comparisons/ every 2s and re-renders. Safe to start/stop any
// time; it never touches the sweep. Usage:  node scripts/watch-sweep.mjs
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "comparisons");
const CSV = path.join(OUT, "summary.csv");

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m", blue: "\x1b[34m", mag: "\x1b[35m",
};
const paint = (s, col) => `${col}${s}${c.reset}`;

// Minimal CSV parse (cells here never contain commas/quotes).
function readCsv() {
  if (!existsSync(CSV)) return [];
  const lines = readFileSync(CSV, "utf8").trim().split("\n");
  if (lines.length < 2) return [];
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
}

// The 6 canonical pipeline steps, rendered as colored dots from trace.jsonl.
const STEP_ORDER = ["interpret_idea", "select_strategy", "generate_application", "verify_journeys", "deterministic_repair", "finalize"];
function stepDots(runDir) {
  const tf = path.join(runDir, "trace.jsonl");
  if (!existsSync(tf)) return paint("· · · · · ·", c.gray);
  let events = [];
  try { events = readFileSync(tf, "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return paint("?", c.gray); }
  const byAction = new Map(events.map((e) => [e.action, e.status]));
  return STEP_ORDER.map((a) => {
    const st = byAction.get(a);
    if (st === "success") return paint("●", c.green);
    if (st === "failed") return paint("●", c.red);
    if (st === "skipped") return paint("○", c.yellow);
    return paint("·", c.gray);
  }).join(" ");
}

function tokens(runDir) {
  const rf = path.join(runDir, "result.json");
  if (!existsSync(rf)) return { calls: "-", total: "-", weighted: "-" };
  try {
    const j = JSON.parse(readFileSync(rf, "utf8"));
    return { calls: String(j.model_calls ?? "-"), total: String(j.total_tokens ?? "-"), weighted: String(j.weighted_token_expenditure ?? "-") };
  } catch { return { calls: "?", total: "?", weighted: "?" }; }
}

// The run.log written most recently across all idea folders = the in-flight run.
function inProgress() {
  let newest = null;
  for (const model of safeDirs(OUT)) {
    for (const idea of safeDirs(path.join(OUT, model))) {
      const log = path.join(OUT, model, idea, "run.log");
      if (!existsSync(log)) continue;
      const mtime = statSync(log).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { model, idea, log, mtime };
    }
  }
  if (!newest) return null;
  if (Date.now() - newest.mtime > 15_000) return null; // idle → sweep between runs or done
  let last = "";
  try { const ls = readFileSync(newest.log, "utf8").trim().split("\n"); last = ls[ls.length - 1] ?? ""; } catch {}
  return { ...newest, last: last.slice(0, 70) };
}
function safeDirs(p) { try { return readdirSync(p).filter((n) => statSync(path.join(p, n)).isDirectory()); } catch { return []; } }

const statusColor = (s) => s === "success" ? c.green : s === "failed" ? c.red : c.yellow;
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const padL = (s, n) => String(s).padStart(n);

function render() {
  const rows = readCsv();
  // Latest row per (model_slug, idea).
  const latest = new Map();
  for (const r of rows) latest.set(`${r.model_slug}|${r.idea}`, r);
  const recs = [...latest.values()];

  let out = "\x1b[2J\x1b[H"; // clear + home
  out += paint("  GLM ⇄ Qwen comparison sweep — live\n", c.bold + c.cyan);
  out += paint(`  steps: interpret ▸ route ▸ compile ▸ qa ▸ repair ▸ finalize     ${new Date().toLocaleTimeString()}\n`, c.gray);
  out += paint("  " + "─".repeat(92) + "\n", c.gray);
  out += paint(`  ${pad("model", 8)}${pad("idea", 26)}${pad("status", 9)}${pad("steps", 14)}${padL("calls", 6)}${padL("tokens", 10)}${padL("weighted", 11)}\n`, c.dim);

  const totals = {};
  for (const r of recs.sort((a, b) => (a.idea + a.model_slug).localeCompare(b.idea + b.model_slug))) {
    const dir = path.join(ROOT, r.run_dir);
    const t = tokens(dir);
    const st = r.status || "?";
    totals[r.model_slug] ??= { n: 0, ok: 0, weighted: 0 };
    totals[r.model_slug].n++;
    if (st === "success") totals[r.model_slug].ok++;
    totals[r.model_slug].weighted += Number(r.weighted_token_expenditure) || 0;
    out += "  " + pad(r.model_slug, 8) + pad(r.idea, 26)
      + paint(pad(st, 9), statusColor(st))
      + stepDots(dir) + "   " // 6 dots = 11 visible chars + 3-space gap; never slice (ANSI)
      + padL(t.calls, 6) + padL(t.total, 10) + padL(t.weighted, 11) + "\n";
  }

  out += paint("  " + "─".repeat(92) + "\n", c.gray);
  for (const [m, s] of Object.entries(totals)) {
    out += paint(`  ${pad(m, 8)}${s.ok}/${s.n} verified   Σ weighted ${s.weighted.toLocaleString()}\n`, c.blue);
  }

  const prog = inProgress();
  out += "\n";
  if (prog) {
    out += paint(`  ▸ running: ${prog.model} · ${prog.idea}\n`, c.mag + c.bold);
    out += paint(`    ${prog.last}\n`, c.gray);
  } else {
    out += paint(`  ▸ no active run (sweep finished, idle, or not started)\n`, c.gray);
  }
  out += paint(`\n  ${recs.length} runs recorded · refreshing every 2s · Ctrl+C to stop watching (sweep keeps running)\n`, c.dim);
  process.stdout.write(out);
}

render();
const timer = setInterval(render, 2000);
process.on("SIGINT", () => { clearInterval(timer); process.stdout.write("\n"); process.exit(0); });
