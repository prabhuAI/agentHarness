import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool, type ExecResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, IsOptional, RemoveOptional, type TObject, type TSchema } from "typebox";
import { classifyCapabilities } from "../compiler/capability-map.js";
import { writeCompiledProduct, writeJourneySummary } from "../compiler/compile.js";
import { normalizeProductIR } from "../ir/normalize.js";
import { validateProductIR } from "../ir/schema.js";
import type { NormalizedProductIR, RouteDecision } from "../ir/types.js";
import { generateLaunchKit } from "../launch/generate.js";
import { TokenGovernor } from "../orchestrator/budget.js";
import { deriveJourneys, type DerivedJourney } from "../qa/derive-journeys.js";
import { classifyFailure, type ClassifiedFailure } from "../qa/classify.js";
import { deterministicRepair } from "../repair/deterministic.js";
import { sha256File, sha256Text, TraceWriter } from "../telemetry/trace.js";
import { verifyRequiredArtifacts } from "../../src/validate-artifacts.js";
import { verifyAppStartup } from "../../src/verify-app.js";

const fieldSchema = Type.Object({
  id: Type.String({ description: "short snake_case semantic key" }),
  label: Type.String(),
  type: Type.String({ description: "One of: text, longText, number, currency, date, datetime, boolean, category, status, email, url. A dropdown/single-select of options is 'category' (a fixed lifecycle is 'status'); never 'select', 'dropdown', or 'enum'." }),
  required: Type.Optional(Type.Boolean({ description: "Defaults to false when omitted" })),
  placeholder: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
  allowCustom: Type.Optional(Type.Boolean()),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  visibleWhen: Type.Optional(Type.Object({
    field: Type.String({ description: "id of another field that controls visibility" }),
    equals: Type.String({ description: "exact controlling value that makes this field visible" }),
  })),
  derive: Type.Optional(Type.Object({
    kind: Type.String({ enum: ["dateThreshold", "formula", "presence"], description: "dateThreshold = a date-based status; formula = arithmetic; presence = a two-state status based on whether another field is empty" }),
    dateField: Type.Optional(Type.String({ description: "dateThreshold only: id of the date field the elapsed span is measured from (e.g. last_watered)" })),
    thresholdField: Type.Optional(Type.String({ description: "id of a number field giving the threshold in days (e.g. watering_frequency); use this or thresholdDays" })),
    thresholdDays: Type.Optional(Type.Number({ description: "fixed threshold span in days when there is no per-record threshold field" })),
    soonWithinDays: Type.Optional(Type.Number({ description: "days before the threshold that count as the 'soon' band (default 0)" })),
    buckets: Type.Optional(Type.Object({
      overdue: Type.String({ description: "option label when the elapsed span has passed the threshold" }),
      soon: Type.String({ description: "option label when within soonWithinDays of the threshold" }),
      ok: Type.String({ description: "option label otherwise" }),
    }, { description: "dateThreshold only: each label must be one of this field's options" })),
    expression: Type.Optional(Type.String({ description: "formula only: arithmetic over other number/currency field ids and numeric literals, using + - * / and parentheses (e.g. \"target_amount - current_amount\", \"price / 12\", \"weight * (1 + reps / 30)\")" })),
    sourceField: Type.Optional(Type.String({ description: "presence only: field whose empty/non-empty state determines this status" })),
    nonEmpty: Type.Optional(Type.String({ description: "presence only: status option when sourceField has a value" })),
    empty: Type.Optional(Type.String({ description: "presence only: status option when sourceField is empty" })),
  }, { description: "Compute this field instead of taking user input. Use dateThreshold for a date lifecycle, formula for arithmetic, or presence for a two-state status derived from whether another field is filled. Never repeat it as a customRequirement." })),
});
const predicateSchema = {
  id: Type.String(),
  label: Type.String(),
  field: Type.String(),
  operator: Type.String({ enum: ["equals", "nonEmpty", "empty", "truthy", "falsy", "today", "thisWeek", "thisMonth"], description: "today/thisWeek/thisMonth filter a date field against the current date and take no value" }),
  value: Type.Optional(Type.String()),
};
const strictProductIRSchema = Type.Object({
  version: Type.String({ enum: ["1"] }),
  product: Type.Object({
    name: Type.String(),
    description: Type.Optional(Type.String()),
    tagline: Type.Optional(Type.String({ description: "Omit unless a short tagline adds real clarity beyond the product name" })),
    targetUser: Type.Optional(Type.String()),
    genome: Type.Optional(Type.String({ enum: ["tracker", "workflow", "catalog", "planner", "dashboard"], description: "Defaults to tracker when omitted" })),
    design: Type.Optional(Type.Object({
      tone: Type.String({ enum: ["calm", "playful", "professional", "bold", "warm", "technical"] }),
      density: Type.String({ enum: ["compact", "comfortable", "spacious"] }),
      contrast: Type.String({ enum: ["soft", "balanced", "high"] }),
      motion: Type.String({ enum: ["none", "subtle", "expressive"] }),
    }, { description: "Four short visual-intent enums; omit when the deterministic genome default is suitable" })),
  }),
  entities: Type.Array(Type.Object({
    name: Type.String({ description: "singular lowercase noun" }),
    plural: Type.Optional(Type.String()),
    primaryField: Type.Optional(Type.String()),
    fields: Type.Array(fieldSchema, { minItems: 1, maxItems: 12 }),
  }), { minItems: 1, maxItems: 3 }),
  capabilities: Type.Optional(Type.Object({
    create: Type.Optional(Type.Boolean()), edit: Type.Optional(Type.Boolean()), delete: Type.Optional(Type.Boolean()), search: Type.Optional(Type.Boolean()),
    filter: Type.Optional(Type.Boolean()), sort: Type.Optional(Type.Boolean()), group: Type.Optional(Type.Boolean()), transition: Type.Optional(Type.Boolean()), calculate: Type.Optional(Type.Boolean()),
  }, { description: "Omitted capabilities default to a create/edit/delete/search CRUD set" })),
  filters: Type.Optional(Type.Array(Type.Object(predicateSchema), { maxItems: 6, description: "Only filters that are not a simple equals check on one category/status field option — those are derived automatically" })),
  calculations: Type.Optional(Type.Array(Type.Object({
    id: Type.String(), label: Type.String(),
    entity: Type.Optional(Type.String({ description: "Entity whose records this metric summarizes; important when the product has multiple entities" })),
    operation: Type.String({ enum: ["count", "countWhere", "sum", "sumWhere"], description: "count = all records; sum = total of a number/currency field; countWhere/sumWhere = over records matching a predicate" }),
    field: Type.Optional(Type.String({ description: "For sum: the number/currency field to total. For countWhere/sumWhere: the field the predicate tests." })),
    operator: Type.Optional(Type.String({ enum: ["equals", "nonEmpty", "empty", "truthy", "falsy", "today", "thisWeek", "thisMonth"] })),
    value: Type.Optional(Type.String()),
    sumField: Type.Optional(Type.String({ description: "For sumWhere: the number/currency field summed over the matching records" })),
  }), { maxItems: 4, description: "Only a totals count and any sums — per-facet-option counts and per-option spend breakdowns are derived automatically" })),
  charts: Type.Optional(Type.Array(Type.Object({
    id: Type.String(),
    label: Type.String(),
    type: Type.String({ enum: ["line"], description: "A line/trend chart" }),
    xField: Type.String({ description: "id of the date or datetime field for the x axis" }),
    yField: Type.String({ description: "id of the number or currency field plotted on the y axis" }),
  }), { maxItems: 3, description: "Trend charts the runtime renders deterministically: a number plotted over time. Use this — never a customRequirement — when the user wants to see a value graphed or track progress over time (e.g. weight over date). Requires a date field and a number/currency field on the entity." })),
  quickActions: Type.Optional(Type.Array(Type.Object({
    id: Type.String(),
    label: Type.String({ description: "the button caption, e.g. \"Done!\", \"Mark paid\", \"Returned\"" }),
    field: Type.String({ description: "id of the field this action mutates" }),
    set: Type.String({ enum: ["today", "clear"], description: "today = stamp a date field to the current date; clear = empty the field" }),
  }), { maxItems: 4, description: "One-tap per-record buttons that set a field to a computed value. Use this — never a customRequirement — for a \"mark done today\" / \"mark paid\" / \"returned\" button that stamps a date field to today or clears a field." })),
  standings: Type.Optional(Type.Array(Type.Object({
    id: Type.String(),
    label: Type.String({ description: "Visible table heading, e.g. League table or Standings" }),
    rowEntity: Type.String({ description: "Entity whose records form the table rows, e.g. team" }),
    sourceEntity: Type.String({ description: "Entity containing the scored events, e.g. match" }),
    participants: Type.Array(Type.Object({
      entityField: Type.String({ description: "Field on the source entity selecting this participant" }),
      scoreForField: Type.String({ description: "Numeric score credited to this participant" }),
      scoreAgainstField: Type.String({ description: "Numeric opposing score for this participant" }),
    }), { minItems: 2, maxItems: 2, description: "Exactly two participant sides, such as home and away" }),
    points: Type.Optional(Type.Object({
      win: Type.Number(), draw: Type.Number(), loss: Type.Number(),
    }, { description: "Points awarded for each outcome; defaults to 3/1/0" })),
  }), { maxItems: 2, description: "Deterministic standings derived from scored records. Use for league tables, ladders, and two-participant rankings; never repeat it as a customRequirement." })),
  priority: Type.Optional(Type.Object({
    label: Type.Optional(Type.String({ description: "Badge for the first matching record, e.g. Next up" })),
    sortField: Type.String({ description: "Field that determines priority order, e.g. arrived_at" }),
    direction: Type.Optional(Type.String({ enum: ["asc", "desc"], description: "asc means earliest/smallest first; defaults to asc" })),
    filter: Type.Optional(Type.Object({
      field: Type.String(),
      operator: Type.String({ enum: ["equals", "nonEmpty", "empty", "truthy", "falsy", "today", "thisWeek", "thisMonth"] }),
      value: Type.Optional(Type.String()),
    }, { description: "Optional subset eligible for priority, e.g. status equals Waiting" })),
  }, { description: "Ordered queue with a highlighted first record. Use for who-is-next, FIFO, oldest-first, triage, or dispatch workflows; never use a customRequirement for these." })),
  persistence: Type.Optional(Type.Object({ strategy: Type.String({ enum: ["localStorage"] }) })),
  assumptions: Type.Optional(Type.Array(Type.String({ description: "short phrase, not a full sentence" }), { maxItems: 12 })),
  excluded: Type.Optional(Type.Array(Type.String({ description: "short phrase, not a full sentence" }), { maxItems: 12 })),
  customRequirements: Type.Optional(Type.Array(Type.String(), { maxItems: 8, description: "Only core behavior not expressible as fields, CRUD, search, filters, states, calculations, multiple entities, standings, or priority queues" })),
});

// Weaker models sometimes emit a nested object/array argument as a JSON *string*
// (e.g. `entities: "[{...}]"`) instead of real JSON. pi-ai validates tool
// arguments against this schema before the tool runs and rejects a stringified
// container, sending the model into a retry loop it cannot escape. Accept a
// string alternative for every object/array property so the call passes
// validation; execute() then parses those strings back with coerceStringifiedIR
// and the strict, hand-written validateProductIR enforces correctness (returning
// a model-visible error if the parsed IR is still wrong). Scalar properties like
// `version` keep their exact schema.
function stringTolerant(schema: TObject): TObject {
  const properties: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    const optional = IsOptional(value);
    const base = optional ? (RemoveOptional(value) as TSchema) : value;
    const kind = (base as { type?: string }).type;
    if (kind === "object" || kind === "array") {
      const union = Type.Union([base, Type.String({ description: "or a JSON string of the same structure" })]);
      properties[key] = optional ? Type.Optional(union) : union;
    } else {
      properties[key] = value;
    }
  }
  return Type.Object(properties);
}

// The lenient schema advertised to the model as compile_product's parameters.
export const productIRSchema = stringTolerant(strictProductIRSchema);

// Index just past the first balanced top-level JSON value in `s`, or -1. String
// aware (brackets inside quotes don't count) so trailing garbage after a complete
// value — the extra `}` weaker models sometimes append — can be sliced off.
function balancedPrefixEnd(s: string): number {
  let depth = 0, inString = false, escaped = false, started = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; started = true; }
    else if (ch === "[" || ch === "{") { depth++; started = true; }
    else if (ch === "]" || ch === "}") { depth--; if (started && depth === 0) return i + 1; }
  }
  return -1;
}

// Locate a closing bracket/brace that cannot match the currently open JSON
// container. This catches a narrowly defined model typo such as `...}}}}]}]`,
// where the extra `}` appears inside an otherwise valid stringified array.
// The caller still requires the complete repaired string to pass JSON.parse.
function unexpectedClosingIndex(s: string): number {
  const stack: string[] = [];
  let inString = false, escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") stack.push(ch);
    else if (ch === "]" || ch === "}") {
      const expected = ch === "]" ? "[" : "{";
      if (stack.at(-1) !== expected) return i;
      stack.pop();
    }
  }
  return -1;
}

// Parse a value that arrived as a JSON string back into JSON. Only strings that
// look like a JSON object/array are touched, so a genuine text value is left
// alone. Falls back to the first balanced prefix when a model appends trailing
// junk (e.g. a stray closing brace) that makes a plain JSON.parse throw.
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try { return JSON.parse(trimmed); } catch { /* fall through to best-effort repair */ }
  const unexpected = unexpectedClosingIndex(trimmed);
  if (unexpected >= 0) {
    const repaired = trimmed.slice(0, unexpected) + trimmed.slice(unexpected + 1);
    try { return JSON.parse(repaired); } catch { /* fall through to prefix repair */ }
  }
  const end = balancedPrefixEnd(trimmed);
  if (end > 0) { try { return JSON.parse(trimmed.slice(0, end)); } catch { /* give up */ } }
  return value;
}

// Undo a model's over-stringification before validation: parse any top-level
// container that arrived as a JSON string, and repair the common nested case
// where `entities`, an entity, or its `fields` were each stringified.
export function coerceStringifiedIR(params: unknown): unknown {
  if (typeof params !== "object" || params === null) return params;
  const out: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  for (const key of Object.keys(out)) out[key] = parseIfJsonString(out[key]);
  if (Array.isArray(out.entities)) {
    out.entities = out.entities.map((entity) => {
      const parsed = parseIfJsonString(entity);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.fields === "string") {
          const fields = parseIfJsonString(record.fields);
          record.fields = Array.isArray(fields) ? fields.map(parseIfJsonString) : fields;
        }
      }
      return parsed;
    });
  }
  return out;
}

interface CompilerState {
  route: RouteDecision;
  journeys: DerivedJourney[];
  llmRepairAttempts?: number;
}

interface QaResult {
  passed: boolean;
  test: ExecResult;
  build: ExecResult;
  startup: ExecResult;
  failure?: ClassifiedFailure;
  repaired: boolean;
}

interface CompilerDependencies {
  verifyStartup: (appRoot: string) => Promise<boolean>;
}

const skipped = (message: string): ExecResult => ({ stdout: "", stderr: message, code: 1, killed: false });

async function runQa(pi: ExtensionAPI, appRoot: string, signal: AbortSignal | undefined, dependencies: CompilerDependencies): Promise<QaResult> {
  const options = { cwd: appRoot, timeout: 120_000, ...(signal ? { signal } : {}) };
  let test = await pi.exec("npm", ["test"], options);
  let build = test.code === 0
    ? await pi.exec("npm", ["run", "build"], options)
    : skipped("Build skipped because tests failed.");
  let startup = test.code === 0 && build.code === 0 && await dependencies.verifyStartup(appRoot)
    ? { stdout: "HTTP startup probe passed.", stderr: "", code: 0, killed: false }
    : skipped(test.code === 0 && build.code === 0 ? "HTTP startup probe failed." : "Startup skipped because tests or build failed.");
  if (test.code === 0 && build.code === 0 && startup.code === 0) return { passed: true, test, build, startup, repaired: false };
  if (startup.code !== 0 && test.code === 0 && build.code === 0) {
    return { passed: false, test, build, startup, failure: classifyFailure("startup", startup.stderr), repaired: false };
  }
  const command = test.code === 0 ? "build" : "test";
  const failed = command === "test" ? test : build;
  const failure = classifyFailure(command, `${failed.stdout}\n${failed.stderr}`);
  const repair = await deterministicRepair(appRoot, failure);
  if (!repair.applied) return { passed: false, test, build, startup, failure, repaired: false };
  test = await pi.exec("npm", ["test"], options);
  build = test.code === 0
    ? await pi.exec("npm", ["run", "build"], options)
    : skipped("Build skipped because repaired tests failed.");
  startup = test.code === 0 && build.code === 0 && await dependencies.verifyStartup(appRoot)
    ? { stdout: "HTTP startup probe passed.", stderr: "", code: 0, killed: false }
    : skipped(test.code === 0 && build.code === 0 ? "HTTP startup probe failed." : "Startup skipped because repaired tests or build failed.");
  const passed = test.code === 0 && build.code === 0 && startup.code === 0;
  return { passed, test, build, startup, failure: passed ? failure : (startup.code !== 0 ? classifyFailure("startup", startup.stderr) : failure), repaired: true };
}

async function writeReport(appRoot: string, ir: NormalizedProductIR, route: RouteDecision, journeys: DerivedJourney[], qa: QaResult): Promise<void> {
  const implemented = [...route.supported, ...(qa.passed ? ir.customRequirements : [])];
  const testsRun = qa.test.code !== 0
    ? [{ command: "npm test (compiled journey suite)", journey: "The compiled product journey suite completes without failures", result: "failed" as const }]
    : [
        ...journeys.map((journey) => ({ command: "npm test (compiled journey suite)", journey: journey.description, result: "passed" as const })),
        ...(qa.build.code !== 0
          ? [{ command: "npm run build", journey: "The generated application completes a production build", result: "failed" as const }]
          : [
              { command: "npm run build", journey: "The generated application completes a production build", result: "passed" as const },
              { command: "npm run dev + HTTP probe", journey: "The generated application starts on port 3000 and answers an HTTP request", result: qa.startup.code === 0 ? "passed" as const : "failed" as const },
            ]),
      ];
  const report = {
    status: qa.passed ? "success" : "partial",
    app_url: "http://localhost:3000",
    start_command: "npm run dev",
    summary: qa.passed ? `${ir.product.name} was compiled and verified.` : `${ir.product.name} was compiled but product verification failed.`,
    implemented_features: [...new Set(implemented)],
    assumptions: ir.assumptions,
    tests_run: testsRun,
  };
  await writeFile(path.join(appRoot, "report.partial.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function artifactHashes(appRoot: string): Promise<Record<string, string>> {
  const names = ["idea_spec.json", "product-ir.json", "summary.md", "report.partial.json"];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await sha256File(path.join(appRoot, name))])));
}

async function recordFinalEvidence(
  appRoot: string,
  trace: TraceWriter,
  ir: NormalizedProductIR,
  route: RouteDecision,
  journeys: DerivedJourney[],
  qa: QaResult,
): Promise<QaResult> {
  await writeJourneySummary(appRoot, ir, route, journeys, qa.passed);
  await writeReport(appRoot, ir, route, journeys, qa);
  await trace.record({ agent: "delivery", action: "finalize", status: qa.passed ? "success" : "failed", artifacts: await artifactHashes(appRoot) });
  if (!qa.passed || (await verifyRequiredArtifacts(appRoot)).result === "passed") return qa;

  const failed = { ...qa, passed: false, failure: classifyFailure("artifacts", "Required artifact validation failed.") };
  await writeJourneySummary(appRoot, ir, route, journeys, false);
  await writeReport(appRoot, ir, route, journeys, failed);
  await trace.record({ agent: "qa", action: "validate_artifacts", status: "failed", category: "validation" });
  await trace.record({ agent: "delivery", action: "finalize", status: "failed", artifacts: await artifactHashes(appRoot) });
  return failed;
}

async function readState(appRoot: string): Promise<{ ir: NormalizedProductIR; state: CompilerState }> {
  const [irRaw, stateRaw] = await Promise.all([
    readFile(path.join(appRoot, "product-ir.json"), "utf8"),
    readFile(path.join(appRoot, ".compiler-state.json"), "utf8"),
  ]);
  return { ir: normalizeProductIR(validateProductIR(JSON.parse(irRaw))), state: JSON.parse(stateRaw) as CompilerState };
}

export function registerProductCompiler(
  pi: ExtensionAPI,
  appRoot: string,
  dependencies: CompilerDependencies = { verifyStartup: verifyAppStartup },
) {
  const configuredBudget = Number(process.env.CHALLENGE_WEIGHTED_TOKEN_BUDGET ?? 18_000);
  const configuredRepairs = Number(process.env.MAX_LLM_REPAIR_ATTEMPTS ?? 2);
  const maximumWeightedTokens = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 18_000;
  const maximumRepairAttempts = Number.isSafeInteger(configuredRepairs) && configuredRepairs > 0 ? configuredRepairs : 2;
  const governor = new TokenGovernor(
    maximumWeightedTokens,
    maximumRepairAttempts,
  );

  pi.registerTool(defineTool({
    name: "compile_product",
    label: "Compile Product",
    description: "Submit the complete Product IR once. This deterministically builds, tests, documents, and finalizes supported products.",
    promptSnippet: "Compile a raw idea from one compact Product IR",
    promptGuidelines: [
      "Call compile_product exactly once after interpreting the idea; do not read or edit application files first.",
      "Use customRequirements only for essential interactions that cannot be represented by fields, CRUD, search, filters, state transitions, or count/sum calculations.",
      "Multiple editable entities are supported deterministically. When scored records involve two participants and the user wants a league table, ladder, or ranking, add both entities plus a standings entry. The two participant fields live on sourceEntity and select records from rowEntity; provide each side's score-for and score-against fields and the win/draw/loss points. Never describe this again in customRequirements.",
      "When a product has multiple entities, set calculation.entity so a metric is counted from the correct record collection (for example, a total of matches must use entity match).",
      "For a status that is a date-based lifecycle (e.g. overdue / due soon / fine from a last-done date and a frequency), add a status field with those options and set its `derive` (kind dateThreshold) instead of a customRequirement — the runtime computes it live and auto-derives its per-band filters and counts.",
      "When a two-state status follows whether another field is filled (borrower present = Lent out, borrower empty = On shelf; assignee present = Assigned), set the status field's `derive` to kind presence with sourceField, nonEmpty, and empty. Never describe field coupling as a customRequirement.",
      "A status the user sets independently (a bill Paid, a task Done) is a plain status field with `transition` enabled. When its value follows whether another field is filled, use a presence-derived status instead.",
      "When the idea asks to see a number graphed or tracked over time (a weight chart, spend trend, progress over dates), add a `charts` entry (type line) with the date field as xField and the number/currency field as yField — never a customRequirement. The runtime renders it deterministically.",
      "For a per-record number computed by arithmetic from other number/currency fields (remaining = target − current, monthly = price ÷ 12, one-rep-max = weight × (1 + reps ÷ 30)), add a number/currency field with `derive` kind formula and an `expression` over the other field ids — never a customRequirement. The runtime evaluates it live.",
      "For a one-tap button on each record that stamps a date field to today (a \"Done!\" / \"Mark paid\" / \"Watered\" button) or clears a field (a \"Returned\" button that empties a borrower), add a `quickActions` entry with the target field id and set today/clear — never a customRequirement. The runtime renders the button and saves the change.",
      "For ambiguous categories, prefer useful suggestions with allowCustom true.",
      "Use visibleWhen for a field that only applies when another field has one exact selected value.",
      "Use product.design only when the idea clearly signals a tone, density, contrast, or motion preference; never generate colors, fonts, CSS, or layout instructions.",
      "Do not list one filter or one count per option: the compiler auto-derives an equals filter and a per-option metric for each option of the primary facet (the status field if present, otherwise one category). When the entity has a currency field, that per-option metric is the option's summed amount (spend breakdown); otherwise it is a count. Only add filters/calculations for logic beyond that: an overall total, cross-field conditions, or a totals count.",
      "For a date window like \"this month\", add a filter on the date field with operator today/thisWeek/thisMonth (no value) — never a value like \"thisMonth\". The runtime evaluates it against the current date.",
      "Omit product.tagline unless a short tagline adds real clarity beyond the product name.",
      "Keep assumptions and excluded entries short phrases, not full sentences.",
      "Add a field placeholder only when the field's purpose is not already obvious from its label and type.",
      "Every field type must be one of: text, longText, number, currency, date, datetime, boolean, category, status, email, url. Use category for a dropdown of options; never select, dropdown, or enum.",
    ],
    parameters: productIRSchema,
    async execute(_id, params, signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: "Validating Product IR and selecting a build route…" }], details: {} });
      const trace = new TraceWriter(appRoot);
      await trace.reset();
      const ir = normalizeProductIR(validateProductIR(coerceStringifiedIR(params)));
      await trace.record({ agent: "product", action: "interpret_idea", status: "success", genome: ir.product.genome, entities: ir.entities.length, ir_sha256: sha256Text(JSON.stringify(ir)) });
      await trace.record({ agent: "product", action: "select_scope", status: "success", included: Object.values(ir.capabilities).filter(Boolean).length, excluded: ir.excluded.length });
      const route = classifyCapabilities(ir);
      const budget = governor.snapshot(route.route);
      await trace.record({ agent: "router", action: "select_strategy", status: "success", strategy: route.route, unsupported: route.unsupported, budget });
      const journeys = deriveJourneys(ir);
      await writeCompiledProduct(appRoot, ir, route, journeys);
      await trace.record({ agent: "compiler", action: "generate_application", status: "success", genome: route.genome, fields: ir.entities[0].fields.length });

      if (route.route !== "compile") {
        const emptyQa: QaResult = {
          passed: false,
          test: { stdout: "", stderr: "Custom implementation required.", code: 1, killed: false },
          build: { stdout: "", stderr: "Custom implementation required.", code: 1, killed: false },
          startup: { stdout: "", stderr: "Custom implementation required.", code: 1, killed: false },
          repaired: false,
        };
        await writeReport(appRoot, ir, route, journeys, emptyQa);
        await trace.record({ agent: "qa", action: "verify_journeys", status: "skipped", reason: "focused custom implementation required" });
        return {
          content: [{ type: "text", text: `Base product compiled via ${route.route}. Implement only: ${route.unsupported.join("; ")}. Start with src/App.tsx only. Read src/styles.css only for a visual requirement, and src/App.test.tsx only when verification reports a test failure. Do not read repository.ts unless persistence itself is the requirement. Apply one focused patch, then call finalize_product.` }],
          details: { route, budget },
        };
      }

      onUpdate?.({ content: [{ type: "text", text: "Running deterministic product journeys and production build…" }], details: {} });
      let qa = await runQa(pi, appRoot, signal, dependencies);
      await trace.record({ agent: "qa", action: "verify_journeys", status: qa.passed ? "success" : "failed", passed: qa.passed ? journeys.length : 0, failed: qa.passed ? 0 : journeys.length, category: qa.failure?.category });
      if (qa.repaired) await trace.record({ agent: "repair", action: "deterministic_repair", status: qa.passed ? "success" : "failed", category: qa.failure?.category });
      qa = await recordFinalEvidence(appRoot, trace, ir, route, journeys, qa);
      if (qa.passed && process.env.CHALLENGE_LAUNCH_MODE === "1") await generateLaunchKit(appRoot, ir);
      // A compile-route product contains no model-authored implementation to repair.
      // If its deterministic runtime still fails after known repairs, that is a
      // compiler invariant failure for us to fix centrally, not an invitation for
      // the model to inspect and rewrite the generated seed over several paid turns.
      const compileInvariantFailed = route.route === "compile" && !qa.passed;
      return {
        content: [{ type: "text", text: qa.passed
          ? `VERIFIED_PASS: ${ir.product.name}`
          : compileInvariantFailed
            ? `Deterministic compile invariant failed (${qa.failure?.category ?? "unknown"}); final status is partial.\n${qa.failure?.relevantOutput ?? ""}`
            : `Verification failed (${qa.failure?.category ?? "unknown"}). Apply a minimal targeted patch, then call finalize_product.` }],
        details: { route, budget, passed: qa.passed, failure: qa.failure },
        terminate: qa.passed || compileInvariantFailed,
      };
    },
  }));

  pi.registerTool(defineTool({
    name: "finalize_product",
    label: "Finalize Product",
    description: "Run bounded verification after a focused custom or repair patch and finalize required artifacts.",
    promptSnippet: "Finalize a compiled product after a focused patch",
    promptGuidelines: ["Call finalize_product immediately after the required focused patch; never write result.json."],
    parameters: Type.Object({}),
    async execute(_id, _params, signal, onUpdate) {
      const { ir, state } = await readState(appRoot);
      const attempts = state.llmRepairAttempts ?? 0;
      onUpdate?.({ content: [{ type: "text", text: `Verifying focused patch (attempt ${attempts + 1})…` }], details: {} });
      let qa = await runQa(pi, appRoot, signal, dependencies);
      const trace = new TraceWriter(appRoot);
      await trace.resume();
      await trace.record({ agent: "qa", action: "verify_after_custom_patch", status: qa.passed ? "success" : "failed", attempt: attempts + 1, category: qa.failure?.category });
      const nextAttempts = attempts + 1;
      await writeFile(path.join(appRoot, ".compiler-state.json"), `${JSON.stringify({ ...state, llmRepairAttempts: nextAttempts }, null, 2)}\n`, "utf8");
      if (qa.passed) {
        if (process.env.CHALLENGE_LAUNCH_MODE === "1") await generateLaunchKit(appRoot, ir);
        qa = await recordFinalEvidence(appRoot, trace, ir, state.route, state.journeys, qa);
        if (qa.passed) return { content: [{ type: "text", text: `VERIFIED_PASS: ${ir.product.name}` }], details: { passed: true }, terminate: true };
      }
      governor.recordLlmRepair();
      const canRetry = nextAttempts < maximumRepairAttempts && governor.canUseLlmRepair(state.route.route);
      await trace.record({ agent: "repair", action: "targeted_llm_repair", status: canRetry ? "started" : "failed", attempt: nextAttempts, category: qa.failure?.category });
      if (!canRetry) qa = await recordFinalEvidence(appRoot, trace, ir, state.route, state.journeys, qa);
      return {
        content: [{ type: "text", text: canRetry ? `${qa.failure?.summary} Fix only the relevant failure and call finalize_product once more.\n${qa.failure?.relevantOutput}` : `Repair budget exhausted. Final status is partial.\n${qa.failure?.relevantOutput}` }],
        details: { passed: false, failure: qa.failure, attempts: nextAttempts },
        terminate: !canRetry,
      };
    },
  }));
}

export default function productCompiler(pi: ExtensionAPI) {
  registerProductCompiler(pi, process.cwd());
}
