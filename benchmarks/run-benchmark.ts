import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BENCHMARK_IDEAS } from "./suite.js";

interface BenchmarkRow {
  index: number;
  idea: string;
  status: string;
  functional_success: boolean;
  first_pass_success: boolean;
  build_success: boolean;
  journey_success: boolean;
  persistence_success: boolean;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  weighted_tokens: number;
  repair_attempts: number;
  runtime_ms: number;
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function run(command: string, args: string[], cwd: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const limit = Math.min(BENCHMARK_IDEAS.length, Math.max(1, Number(argument("--limit", "20"))));
const reportPath = path.resolve(repositoryRoot, argument("--report", "artifacts/benchmark-report.json"));
const temp = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-benchmark-"));
const rows: BenchmarkRow[] = [];
await mkdir(path.dirname(reportPath), { recursive: true });

try {
  for (let index = 0; index < limit; index += 1) {
    const idea = BENCHMARK_IDEAS[index]!;
    const ideaPath = path.join(temp, `idea-${index + 1}.txt`);
    await writeFile(ideaPath, `${idea}\n`, "utf8");
    const started = Date.now();
    const outputDirectory = `output/benchmark-${String(index + 1).padStart(3, "0")}`;
    const exitCode = await run("npm", ["run", "challenge", "--", "--idea-file", ideaPath, "--output-dir", outputDirectory], repositoryRoot);
    let result: Record<string, unknown> = {};
    try { result = JSON.parse(await readFile(path.join(repositoryRoot, outputDirectory, "result.json"), "utf8")) as Record<string, unknown>; } catch { /* failed run stays measurable */ }
    const harness = Array.isArray(result.harness_checks) ? result.harness_checks as Array<Record<string, unknown>> : [];
    const tests = Array.isArray(result.tests_run) ? result.tests_run as Array<Record<string, unknown>> : [];
    const trace = await readFile(path.join(repositoryRoot, outputDirectory, "trace.jsonl"), "utf8").catch(() => "");
    rows.push({
      index: index + 1,
      idea,
      status: String(result.status ?? "failed"),
      functional_success: exitCode === 0 && result.status === "success",
      first_pass_success: !trace.includes('"agent":"repair"'),
      build_success: harness.some((check) => check.command === "npm run build" && check.result === "passed"),
      journey_success: tests.length > 0 && tests.every((test) => test.result === "passed"),
      persistence_success: tests.some((test) => String(test.journey).toLowerCase().includes("refresh") && test.result === "passed"),
      model_calls: Number(result.model_calls ?? 0),
      input_tokens: Number(result.input_tokens ?? 0),
      output_tokens: Number(result.output_tokens ?? 0),
      cache_read_tokens: Number(result.cache_read_tokens ?? 0),
      weighted_tokens: Number(result.weighted_token_expenditure ?? 0),
      repair_attempts: (trace.match(/"agent":"repair"/gu) ?? []).length,
      runtime_ms: Date.now() - started,
    });
    await writeFile(reportPath, `${JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2)}\n`, "utf8");
  }
} finally {
  await rm(temp, { recursive: true });
}

const success = rows.filter((row) => row.functional_success).length;
console.log(`Benchmark complete: ${success}/${rows.length} successful. Report: ${reportPath}`);
