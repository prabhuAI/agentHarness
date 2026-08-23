// capability-candidates.mjs — deterministic "what should we teach the compiler next?"
//
// Scans past runs for the features that forced the expensive hybrid/LLM route
// (customRequirements in each Product IR), buckets them into pattern families
// with fixed keyword rules (NO LLM — this is the deterministic detection layer),
// and ranks the families by how often they recur. Recurring, general families are
// promotion candidates for the deterministic compiler; one-off novel ones stay on
// the LLM tail. Usage:  node scripts/capability-candidates.mjs [scanDir ...]
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const SCAN_DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ["comparisons", "artifacts/runs"];

// Fixed pattern families. Each rule: a family label, whether it is a promotable
// deterministic primitive, and a matcher over the (lowercased) requirement text.
const FAMILIES = [
  { key: "set-field-to-today", promotable: true,
    why: "A quick-action button that stamps a date/status field to today (mark done / paid / watered / serviced).",
    test: (t) => /(set|mark|stamp|log|record).*(today|now|done|complete)|done!?.*button|just did it|one tap/.test(t) || (/last_done|last done/.test(t) && /today|button|tap/.test(t)) },
  { key: "number-threshold-status", promotable: true,
    why: "A derived status from a number vs a threshold (running low / over budget) — a numeric sibling of dateThreshold.",
    test: (t) => /(quantity|stock|amount|count|level).*(threshold|low|below|at or below|over|above)|running low/.test(t) },
  { key: "elapsed-since", promotable: true,
    why: "A live 'time since <date>' display computed from today.",
    test: (t) => /(how long|time since|days? (and weeks?|since)|elapsed).*/.test(t) },
  { key: "boolean-toggle-and-count", promotable: true,
    why: "Tick a boolean per record and show done/total counts + filter by it.",
    test: (t) => /(tick|toggle|check).*(off|packed|done)|packed vs|checked off|mark.*(off|as (packed|done))/.test(t) },
  { key: "nested-sub-items", promotable: false,
    why: "A record owning a list of sub-items (parent/child entities) — a bigger relational change.",
    test: (t) => /(each|per) .*(has|contains|list of) .*(item|sub|line)/.test(t) },
  { key: "interactive-game", promotable: false,
    why: "A real-time game/interactive experience — not a record-management app; correct LLM-tail work.",
    test: (t) => /(game|play again|new game|round|score|star|speech|celebrat|tappable|board)/.test(t) },
];
const classify = (text) => (FAMILIES.find((f) => f.test(text.toLowerCase()))?.key) ?? "other-novel";

// Collect every customRequirement from product-ir.json files under the scan dirs.
const found = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name === "product-ir.json") {
      try {
        const ir = JSON.parse(readFileSync(p, "utf8"));
        const idea = deriveIdeaLabel(p);
        for (const req of ir.customRequirements ?? []) found.push({ req, idea, family: classify(req) });
      } catch { /* skip unreadable */ }
    }
  }
}
function deriveIdeaLabel(p) {
  // comparisons/<model>/<idea>/product-ir.json  →  <model>/<idea>
  const parts = p.split(path.sep);
  const i = parts.indexOf("comparisons");
  if (i >= 0 && parts[i + 2]) return `${parts[i + 1]}/${parts[i + 2]}`;
  return path.dirname(p).split(path.sep).slice(-2).join("/");
}
for (const d of SCAN_DIRS) walk(d);

// Aggregate by family.
const byFamily = new Map();
for (const f of found) {
  if (!byFamily.has(f.family)) byFamily.set(f.family, { count: 0, ideas: new Set(), examples: [] });
  const e = byFamily.get(f.family);
  e.count++; e.ideas.add(f.idea);
  if (e.examples.length < 2) e.examples.push(f.req.replace(/\s+/g, " ").slice(0, 90));
}
const meta = (k) => FAMILIES.find((f) => f.key === k);
const ranked = [...byFamily.entries()].sort((a, b) => b[1].ideas.size - a[1].ideas.size || b[1].count - a[1].count);

console.log(`\nCapability candidates — scanned ${SCAN_DIRS.join(", ")}`);
console.log(`${found.length} custom requirements across ${new Set(found.map((f) => f.idea)).size} runs\n`);
console.log("PROMOTE (recurring, general → deterministic capability):");
for (const [key, e] of ranked) {
  if (!(meta(key)?.promotable)) continue;
  console.log(`  • ${key}  — ${e.ideas.size} idea(s), ${e.count} occurrence(s)`);
  console.log(`      ${meta(key)?.why}`);
  for (const ex of e.examples) console.log(`      e.g. "${ex}"`);
}
console.log("\nKEEP ON LLM TAIL (novel / one-off):");
for (const [key, e] of ranked) {
  if (meta(key)?.promotable) continue;
  console.log(`  • ${key === "other-novel" ? "other-novel" : key}  — ${e.ideas.size} idea(s), ${e.count} occurrence(s)${meta(key) ? " — " + meta(key).why : ""}`);
}
console.log("");
