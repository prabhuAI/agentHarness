import { readFile } from "node:fs/promises";
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
    const validTrace = trace.length >= 5 && trace.every((event, index) => isRecord(event) && event.step === index + 1 && typeof event.agent === "string" && typeof event.action === "string" && typeof event.status === "string");
    const forbiddenTrace = /chain[-_ ]of[-_ ]thought|full_prompt|source_code/iu.test(traceRaw);
    const passed = validSpec && validIr && validTrace && !forbiddenTrace && summary.trim().startsWith("# ");
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
