import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool, type ExecResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { classifyCapabilities } from "../compiler/capability-map.js";
import { writeCompiledProduct } from "../compiler/compile.js";
import { normalizeProductIR } from "../ir/normalize.js";
import { validateProductIR } from "../ir/schema.js";
import type { NormalizedProductIR, RouteDecision } from "../ir/types.js";
import { generateLaunchKit } from "../launch/generate.js";
import { TokenGovernor } from "../orchestrator/budget.js";
import { deriveJourneys, type DerivedJourney } from "../qa/derive-journeys.js";
import { classifyFailure, type ClassifiedFailure } from "../qa/classify.js";
import { deterministicRepair } from "../repair/deterministic.js";
import { TraceWriter } from "../telemetry/trace.js";

const fieldSchema = Type.Object({
  id: Type.String({ description: "short snake_case semantic key" }),
  label: Type.String(),
  type: Type.String({ enum: ["text", "longText", "number", "currency", "date", "datetime", "boolean", "category", "status", "email", "url"] }),
  required: Type.Boolean(),
  placeholder: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
  allowCustom: Type.Optional(Type.Boolean()),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
});
const predicateSchema = {
  id: Type.String(),
  label: Type.String(),
  field: Type.String(),
  operator: Type.String({ enum: ["equals", "nonEmpty", "empty", "truthy", "falsy"] }),
  value: Type.Optional(Type.String()),
};
const productIRSchema = Type.Object({
  version: Type.String({ enum: ["1"] }),
  product: Type.Object({
    name: Type.String(),
    description: Type.String(),
    tagline: Type.String(),
    targetUser: Type.String(),
    genome: Type.String({ enum: ["tracker", "workflow", "catalog", "planner", "dashboard"] }),
    accent: Type.Optional(Type.String({ description: "accessible six-digit hex color" })),
  }),
  entities: Type.Array(Type.Object({
    name: Type.String({ description: "singular lowercase noun" }),
    plural: Type.String(),
    primaryField: Type.String(),
    fields: Type.Array(fieldSchema, { minItems: 1, maxItems: 12 }),
  }), { minItems: 1, maxItems: 3 }),
  capabilities: Type.Object({
    create: Type.Boolean(), edit: Type.Boolean(), delete: Type.Boolean(), search: Type.Boolean(),
    filter: Type.Boolean(), sort: Type.Boolean(), group: Type.Boolean(), transition: Type.Boolean(), calculate: Type.Boolean(),
  }),
  filters: Type.Array(Type.Object(predicateSchema), { maxItems: 12 }),
  calculations: Type.Array(Type.Object({
    id: Type.String(), label: Type.String(),
    operation: Type.String({ enum: ["count", "countWhere", "sum"] }),
    field: Type.Optional(Type.String()),
    operator: Type.Optional(Type.String({ enum: ["equals", "nonEmpty", "empty", "truthy", "falsy"] })),
    value: Type.Optional(Type.String()),
  }), { maxItems: 8 }),
  persistence: Type.Object({ strategy: Type.String({ enum: ["localStorage"] }) }),
  assumptions: Type.Array(Type.String(), { maxItems: 12 }),
  excluded: Type.Array(Type.String(), { maxItems: 12 }),
  customRequirements: Type.Array(Type.String(), { maxItems: 8, description: "Only core behavior not expressible as fields, CRUD, search, filters, states, or calculations" }),
});

interface CompilerState {
  route: RouteDecision;
  journeys: DerivedJourney[];
  llmRepairAttempts?: number;
}

interface QaResult {
  passed: boolean;
  test: ExecResult;
  build: ExecResult;
  failure?: ClassifiedFailure;
  repaired: boolean;
}

async function runQa(pi: ExtensionAPI, appRoot: string, signal: AbortSignal | undefined): Promise<QaResult> {
  const options = { cwd: appRoot, timeout: 120_000, ...(signal ? { signal } : {}) };
  let test = await pi.exec("npm", ["test"], options);
  let build = test.code === 0
    ? await pi.exec("npm", ["run", "build"], options)
    : { stdout: "", stderr: "Build skipped because tests failed.", code: 1, killed: false };
  if (test.code === 0 && build.code === 0) return { passed: true, test, build, repaired: false };
  const command = test.code === 0 ? "build" : "test";
  const failed = command === "test" ? test : build;
  const failure = classifyFailure(command, `${failed.stdout}\n${failed.stderr}`);
  const repair = await deterministicRepair(appRoot, failure);
  if (!repair.applied) return { passed: false, test, build, failure, repaired: false };
  test = await pi.exec("npm", ["test"], options);
  build = test.code === 0
    ? await pi.exec("npm", ["run", "build"], options)
    : { stdout: "", stderr: "Build skipped because repaired tests failed.", code: 1, killed: false };
  return { passed: test.code === 0 && build.code === 0, test, build, failure, repaired: true };
}

async function writeReport(appRoot: string, ir: NormalizedProductIR, route: RouteDecision, journeys: DerivedJourney[], qa: QaResult): Promise<void> {
  const implemented = [...route.supported, ...(qa.passed ? ir.customRequirements : [])];
  const report = {
    status: qa.passed ? "success" : "partial",
    app_url: "http://localhost:3000",
    start_command: "npm run dev",
    summary: qa.passed ? `${ir.product.name} was compiled and verified.` : `${ir.product.name} was compiled but product verification failed.`,
    implemented_features: [...new Set(implemented)],
    assumptions: ir.assumptions,
    tests_run: journeys.map((journey) => ({ command: "npm test", journey: journey.description, result: qa.passed ? "passed" : "failed" })),
  };
  await writeFile(path.join(appRoot, "report.partial.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function readState(appRoot: string): Promise<{ ir: NormalizedProductIR; state: CompilerState }> {
  const [irRaw, stateRaw] = await Promise.all([
    readFile(path.join(appRoot, "product-ir.json"), "utf8"),
    readFile(path.join(appRoot, ".compiler-state.json"), "utf8"),
  ]);
  return { ir: normalizeProductIR(validateProductIR(JSON.parse(irRaw))), state: JSON.parse(stateRaw) as CompilerState };
}

export function registerProductCompiler(pi: ExtensionAPI, appRoot: string) {
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
      "For ambiguous categories, prefer useful suggestions with allowCustom true.",
    ],
    parameters: productIRSchema,
    async execute(_id, params, signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: "Validating Product IR and selecting a build route…" }], details: {} });
      const trace = new TraceWriter(appRoot);
      await trace.reset();
      const ir = normalizeProductIR(validateProductIR(params));
      await trace.record({ agent: "product", action: "interpret_idea", status: "success", genome: ir.product.genome, entities: ir.entities.length });
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
          repaired: false,
        };
        await writeReport(appRoot, ir, route, journeys, emptyQa);
        await trace.record({ agent: "qa", action: "verify_journeys", status: "skipped", reason: "focused custom implementation required" });
        return {
          content: [{ type: "text", text: `Base product compiled via ${route.route}. Implement only: ${route.unsupported.join("; ")}. Then call finalize_product.` }],
          details: { route, budget },
        };
      }

      onUpdate?.({ content: [{ type: "text", text: "Running deterministic product journeys and production build…" }], details: {} });
      const qa = await runQa(pi, appRoot, signal);
      await writeReport(appRoot, ir, route, journeys, qa);
      await trace.record({ agent: "qa", action: "verify_journeys", status: qa.passed ? "success" : "failed", passed: qa.passed ? journeys.length : 0, failed: qa.passed ? 0 : journeys.length, category: qa.failure?.category });
      if (qa.repaired) await trace.record({ agent: "repair", action: "deterministic_repair", status: qa.passed ? "success" : "failed", category: qa.failure?.category });
      await trace.record({ agent: "delivery", action: "finalize", status: qa.passed ? "success" : "failed" });
      if (qa.passed && process.env.CHALLENGE_LAUNCH_MODE === "1") await generateLaunchKit(appRoot, ir);
      return {
        content: [{ type: "text", text: qa.passed ? `VERIFIED_PASS: ${ir.product.name}` : `Verification failed (${qa.failure?.category ?? "unknown"}). Apply a minimal targeted patch, then call finalize_product.` }],
        details: { route, budget, passed: qa.passed, failure: qa.failure },
        terminate: qa.passed,
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
      const qa = await runQa(pi, appRoot, signal);
      await writeReport(appRoot, ir, state.route, state.journeys, qa);
      const trace = new TraceWriter(appRoot);
      await trace.resume();
      await trace.record({ agent: "qa", action: "verify_after_custom_patch", status: qa.passed ? "success" : "failed", attempt: attempts + 1, category: qa.failure?.category });
      const nextAttempts = attempts + 1;
      await writeFile(path.join(appRoot, ".compiler-state.json"), `${JSON.stringify({ ...state, llmRepairAttempts: nextAttempts }, null, 2)}\n`, "utf8");
      if (qa.passed) {
        if (process.env.CHALLENGE_LAUNCH_MODE === "1") await generateLaunchKit(appRoot, ir);
        await trace.record({ agent: "delivery", action: "finalize", status: "success" });
        return { content: [{ type: "text", text: `VERIFIED_PASS: ${ir.product.name}` }], details: { passed: true }, terminate: true };
      }
      governor.recordLlmRepair();
      const canRetry = nextAttempts < maximumRepairAttempts && governor.canUseLlmRepair(state.route.route);
      await trace.record({ agent: "repair", action: "targeted_llm_repair", status: canRetry ? "started" : "failed", attempt: nextAttempts, category: qa.failure?.category });
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
