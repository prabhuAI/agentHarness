// spec-probe.ts — Cheap "which route would this idea take?" probe.
//
// For each idea file it makes ONE model call that forces the compile_product
// tool, takes the Product IR the model returns, and runs the REAL router
// (normalize -> validate -> classifyCapabilities) on it. No build, no npm ci,
// no QA — so it costs ~1 small model call per idea instead of a full run.
//
// Route = "compile" iff single entity AND empty customRequirements; otherwise
// hybrid/custom. The output tells you exactly why each idea would route away
// from the cheap deterministic path.
//
// Usage:
//   BERGET_API_KEY=... node --import tsx scripts/spec-probe.ts [ideaGlobStems...]
//   (no args = every *.txt in test-ideas/)
//
// Env: CHALLENGE_PROVIDER (default berget), CHALLENGE_MODEL (default the first
//      berget model in provider-config/models.json).

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productIRSchema } from "../solution/extensions/product-compiler.js";
import { classifyCapabilities } from "../solution/compiler/capability-map.js";
import { normalizeProductIR } from "../solution/ir/normalize.js";
import { validateProductIR } from "../solution/ir/schema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDEAS_DIR = path.join(ROOT, "test-ideas");
const OUT_JSON = path.join(ROOT, "comparisons", "spec-probe.json");

// Kept in sync with the compile_product tool's promptGuidelines + system-prompt.md
// so the model produces the same IR shape it would in a real run.
const GUIDELINES = [
  "Call compile_product exactly once after interpreting the idea; do not read or edit application files first.",
  "Use customRequirements only for essential interactions that cannot be represented by fields, CRUD, search, filters, state transitions, or count/sum calculations.",
  "For a status that is a date-based lifecycle (e.g. overdue / due soon / fine from a last-done date and a frequency), add a status field with those options and set its `derive` (kind dateThreshold) instead of a customRequirement — the runtime computes it live and auto-derives its per-band filters and counts.",
  "A status the user sets by hand (marking an item Lent then Returned, a bill Paid, a task Done) is a plain status field with `transition` enabled — the user edits it directly. Never add a customRequirement to auto-flip a status from whether another field is filled in or cleared; that coupling is ordinary editing, and a manually-set status field with its options covers it.",
  "When the idea asks to see a number graphed or tracked over time (a weight chart, spend trend, progress over dates), add a `charts` entry (type line) with the date field as xField and the number/currency field as yField — never a customRequirement. The runtime renders it deterministically.",
  "For a per-record number computed by arithmetic from other number/currency fields (remaining = target − current, monthly = price ÷ 12, one-rep-max = weight × (1 + reps ÷ 30)), add a number/currency field with `derive` kind formula and an `expression` over the other field ids — never a customRequirement. The runtime evaluates it live.",
  "For ambiguous categories, prefer useful suggestions with allowCustom true.",
  "Model related facts as fields on one entity rather than separate entities unless the idea clearly needs several; a borrower, owner, assignee, or status is a field on the main record, not its own entity.",
  "Setting or clearing a field value is ordinary editing, never a customRequirement.",
  "Always emit every Product IR field, using empty arrays for filters, calculations, assumptions, excluded, and customRequirements when none apply.",
];

async function loadBergetConfig() {
  const raw = await readFile(path.join(ROOT, "solution", "provider-config", "models.json"), "utf8");
  const cfg = JSON.parse(raw);
  const providerName = process.env.CHALLENGE_PROVIDER ?? "berget";
  const provider = cfg.providers[providerName];
  if (!provider) throw new Error(`provider ${providerName} not in models.json`);
  const modelId = process.env.CHALLENGE_MODEL ?? provider.models[0].id;
  const model = provider.models.find((m: any) => m.id === modelId) ?? provider.models[0];
  return { providerName, provider, modelId: model.id };
}

const SYSTEM_PROMPT = [
  "Interpret the product idea once and call compile_product with a complete, compact Product IR. Do not inspect or edit files before that call.",
  "Build the smallest useful MVP. Resolve ambiguity sensibly. Prefer one local user and browser-local persistence. Put unsupported essential interactions—not ordinary CRUD, fields, filters, states, or count/sum calculations—in customRequirements. Leave customRequirements empty unless a core interaction genuinely cannot be expressed as fields, CRUD, search, filters, status values, or count/sum calculations.",
  "",
  "Tool guidelines:",
  ...GUIDELINES.map((g) => `- ${g}`),
].join("\n");

async function callModel(baseUrl: string, apiKey: string, modelId: string, idea: string) {
  const body = {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: idea },
    ],
    tools: [{
      type: "function",
      function: {
        name: "compile_product",
        description: "Submit the complete Product IR once.",
        parameters: productIRSchema,
      },
    }],
    tool_choice: { type: "function", function: { name: "compile_product" } },
    temperature: 0,
    max_tokens: 4096,
    chat_template_kwargs: { enable_thinking: false },
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error(`no tool_call in response: ${JSON.stringify(json.choices?.[0]?.message).slice(0, 300)}`);
  const raw = call.function.arguments;
  if (process.env.PROBE_RAW) {
    console.log("\n--- RAW tool_call arguments ---\n" + raw + "\n--- end raw ---\n");
  }
  const ir = JSON.parse(raw);
  return { ir, usage: json.usage ?? {}, raw };
}

async function main() {
  const apiKey = process.env.BERGET_API_KEY ?? process.env.CHALLENGE_API_KEY;
  const { provider, modelId } = await loadBergetConfig();
  if (!apiKey) throw new Error("BERGET_API_KEY not set in the shell.");

  const stems = process.argv.slice(2).map((s) => s.replace(/\.txt$/, ""));
  const all = (await readdir(IDEAS_DIR)).filter((f) => f.endsWith(".txt"));
  const files = (stems.length ? all.filter((f) => stems.includes(f.replace(/\.txt$/, ""))) : all).sort();

  console.log(`Probing ${files.length} ideas against ${modelId}\n`);
  const rows: any[] = [];
  for (const file of files) {
    const slug = file.replace(/\.txt$/, "");
    const idea = (await readFile(path.join(IDEAS_DIR, file), "utf8")).trim();
    if (!idea) continue;
    let lastRaw = "";
    try {
      const { ir, usage, raw } = await callModel(provider.baseUrl, apiKey, modelId, idea);
      lastRaw = raw;
      const normalized = normalizeProductIR(validateProductIR(ir));
      const route = classifyCapabilities(normalized);
      rows.push({
        idea: slug,
        product: normalized.product.name,
        genome: normalized.product.genome,
        entities: normalized.entities.length,
        route: route.route,
        customRequirements: normalized.customRequirements,
        unsupported: route.unsupported,
        input_tokens: usage.prompt_tokens ?? "",
        output_tokens: usage.completion_tokens ?? "",
      });
      const tag = route.route === "compile" ? "✅ compile" : `⚠️  ${route.route}`;
      console.log(`${tag.padEnd(12)} ${slug.padEnd(26)} entities=${normalized.entities.length} custom=[${normalized.customRequirements.join(" | ")}]`);
    } catch (err) {
      rows.push({ idea: slug, route: "ERROR", error: String(err).slice(0, 200), raw: lastRaw });
      console.log(`❌ ERROR      ${slug.padEnd(26)} ${String(err).slice(0, 120)}`);
      if (lastRaw) console.log(`   --- RAW spec the model returned ---\n${lastRaw}\n   --- end raw ---`);
    }
  }

  // Summary.
  const byRoute: Record<string, string[]> = {};
  for (const r of rows) (byRoute[r.route] ??= []).push(r.idea);
  console.log("\n=== Route summary ===");
  for (const [route, ideas] of Object.entries(byRoute)) {
    console.log(`${route.padEnd(10)} ${ideas.length.toString().padStart(2)}  ${ideas.join(", ")}`);
  }
  const needsThreshold = rows.filter((r) =>
    (r.customRequirements ?? []).some((c: string) => /low|threshold|below|at or (above|below)|running (low|out)|remaining|stock|progress|close to|target/i.test(c)),
  );
  console.log(`\nIdeas whose custom requirement looks like a NUMBER-threshold rule: ${needsThreshold.length}`);
  for (const r of needsThreshold) console.log(`  - ${r.idea}: ${r.customRequirements.join(" | ")}`);

  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(rows, null, 2) + "\n", "utf8");
  console.log(`\nFull spec/route detail written to ${path.relative(ROOT, OUT_JSON)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
