import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { TestRun } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function verifyRequiredArtifacts(appDirectory: string): Promise<TestRun> {
  try {
    const [specRaw, summary, traceRaw, irRaw] = await Promise.all([
      readFile(path.join(appDirectory, "idea_spec.json"), "utf8"),
      readFile(path.join(appDirectory, "summary.md"), "utf8"),
      readFile(path.join(appDirectory, "trace.jsonl"), "utf8"),
      readFile(path.join(appDirectory, "product-ir.json"), "utf8"),
    ]);
    const spec = JSON.parse(specRaw) as unknown;
    const ir = JSON.parse(irRaw) as unknown;
    const trace = traceRaw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as unknown);
    const validSpec = isRecord(spec) && typeof spec.target_user === "string" && typeof spec.core_utility === "string" && Array.isArray(spec.included_features) && Array.isArray(spec.excluded_features) && Array.isArray(spec.assumptions);
    const validIr = isRecord(ir) && ir.version === "1" && isRecord(ir.product) && Array.isArray(ir.entities);
    const expectedPrefix = ["interpret_idea", "select_scope", "select_strategy", "generate_application"];
    const validTrace = trace.length >= 6 && trace.every((event, index) => isRecord(event) &&
      event.step === index + 1 &&
      typeof event.timestamp === "string" && !Number.isNaN(Date.parse(event.timestamp)) &&
      typeof event.agent === "string" && typeof event.action === "string" &&
      ["started", "success", "failed", "skipped"].includes(String(event.status)));
    const validOrder = expectedPrefix.every((action, index) => isRecord(trace[index]) && trace[index].action === action) &&
      trace.some((event) => isRecord(event) && event.agent === "qa" && String(event.action).startsWith("verify"));
    const scopeEvent = trace.find((event) => isRecord(event) && event.action === "select_scope");
    const routeEvent = trace.find((event) => isRecord(event) && event.action === "select_strategy");
    const validDecisions = isRecord(scopeEvent) && Array.isArray(scopeEvent.included) &&
      Array.isArray(scopeEvent.assumptions) && Array.isArray(scopeEvent.excluded) && Array.isArray(scopeEvent.customRequirements) &&
      isRecord(routeEvent) && typeof routeEvent.reason === "string" && routeEvent.reason.length > 0 &&
      Array.isArray(routeEvent.supported) && Array.isArray(routeEvent.unsupported);
    const finalEvent = trace.at(-1);
    const declaredArtifacts = isRecord(finalEvent) && isRecord(finalEvent.artifacts) ? finalEvent.artifacts : undefined;
    const requiredHashes: Record<string, string> = {
      "idea_spec.json": createHash("sha256").update(specRaw).digest("hex"),
      "product-ir.json": createHash("sha256").update(irRaw).digest("hex"),
      "summary.md": createHash("sha256").update(summary).digest("hex"),
      "report.partial.json": createHash("sha256").update(await readFile(path.join(appDirectory, "report.partial.json"), "utf8")).digest("hex"),
    };
    const validDelivery = isRecord(finalEvent) && finalEvent.agent === "delivery" && finalEvent.action === "finalize" &&
      finalEvent.status === "success" && declaredArtifacts !== undefined &&
      Object.entries(requiredHashes).every(([name, hash]) => declaredArtifacts[name] === hash);
    const forbiddenTrace = /chain[-_ ]of[-_ ]thought|full_prompt|source_code/iu.test(traceRaw);
    const passed = validSpec && validIr && validTrace && validOrder && validDecisions && validDelivery && !forbiddenTrace && summary.includes("## Verified journeys");
    return {
      command: "validate required artifacts",
      journey: "idea_spec.json, product-ir.json, summary.md, and auditable trace.jsonl are complete",
      result: passed ? "passed" : "failed",
    };
  } catch {
    return {
      command: "validate required artifacts",
      journey: "idea_spec.json, product-ir.json, summary.md, and auditable trace.jsonl are complete",
      result: "failed",
    };
  }
}
