// Read comparisons/summary.csv and print a side-by-side per-idea comparison
// plus per-model totals. Usage: node scripts/compare-report.mjs [path-to-csv]
import { readFileSync, existsSync } from "node:fs";

const csvPath = process.argv[2] ?? "comparisons/summary.csv";
if (!existsSync(csvPath)) {
  console.error(`No CSV at ${csvPath}. Run scripts/run-comparison.sh first.`);
  process.exit(1);
}

// Minimal CSV parser (handles quoted cells).
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c === "\r") { /* skip */ }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(csvPath, "utf8")).filter((r) => r.length > 1);
const header = rows.shift();
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const num = (v) => (v === "" || v === undefined ? NaN : Number(v));

// Keep only the LAST run for each (model_slug, idea) pair, so re-runs override.
const latest = new Map();
for (const r of rows) latest.set(`${r[idx.model_slug]}|${r[idx.idea]}`, r);
const records = [...latest.values()];

const models = [...new Set(records.map((r) => r[idx.model_slug]))].sort();
const ideas = [...new Set(records.map((r) => r[idx.idea]))].sort();
const get = (model, idea) => latest.get(`${model}|${idea}`);

const pad = (s, w) => String(s ?? "").padEnd(w);
const padL = (s, w) => String(s ?? "").padStart(w);

// ---- Per-idea comparison of weighted tokens + status ----
console.log(`\nComparison from ${csvPath} — ${ideas.length} ideas × ${models.length} models\n`);
console.log("Weighted token expenditure (status) per idea:\n");
const ideaW = Math.max(6, ...ideas.map((i) => i.length));
const colW = 22;
let head = pad("idea", ideaW);
for (const m of models) head += "  " + pad(m, colW);
console.log(head);
console.log("-".repeat(head.length));
for (const idea of ideas) {
  let line = pad(idea, ideaW);
  for (const m of models) {
    const r = get(m, idea);
    const cell = r ? `${num(r[idx.weighted_token_expenditure]) || "-"} (${r[idx.status]})` : "—";
    line += "  " + pad(cell, colW);
  }
  console.log(line);
}

// ---- Per-model totals ----
console.log(`\nPer-model totals:\n`);
const metrics = ["input_tokens", "output_tokens", "total_tokens", "weighted_token_expenditure", "cost_total", "model_calls"];
const mW = Math.max(...models.map((m) => m.length), 8);
let th = pad("model", mW) + "  " + padL("runs", 5) + "  " + padL("verified", 8);
for (const k of metrics) th += "  " + padL(k, 14);
console.log(th);
console.log("-".repeat(th.length));
for (const m of models) {
  const rs = records.filter((r) => r[idx.model_slug] === m);
  const verified = rs.filter((r) => r[idx.status] === "verified").length;
  let line = pad(m, mW) + "  " + padL(rs.length, 5) + "  " + padL(`${verified}/${rs.length}`, 8);
  for (const k of metrics) {
    const sum = rs.reduce((a, r) => a + (num(r[idx[k]]) || 0), 0);
    line += "  " + padL(k === "cost_total" ? sum.toFixed(4) : sum, 14);
  }
  console.log(line);
}
console.log();
