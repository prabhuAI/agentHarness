// Append one row to comparisons/summary.csv, parsed from a run's result.json.
// argv: csvPath ts slug provider modelId ideaSlug resultJsonPath exitCode runDir
import { appendFileSync, readFileSync, existsSync } from "node:fs";

const [csvPath, ts, slug, provider, modelId, ideaSlug, resultPath, exitCode, runDir] =
  process.argv.slice(2);

const csvCell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

let r = {};
if (existsSync(resultPath)) {
  try {
    r = JSON.parse(readFileSync(resultPath, "utf8"));
  } catch {
    r = { status: "unparseable_result_json" };
  }
} else {
  r = { status: "no_result_json" };
}

const row = [
  ts,
  slug,
  provider,
  modelId,
  ideaSlug,
  r.status ?? "",
  r.model_calls ?? "",
  r.input_tokens ?? "",
  r.output_tokens ?? "",
  r.cache_read_tokens ?? "",
  r.cache_write_tokens ?? "",
  r.reasoning_tokens ?? "",
  r.total_tokens ?? "",
  r.weighted_token_expenditure ?? "",
  r.cost_total ?? "",
  exitCode,
  runDir,
].map(csvCell).join(",");

appendFileSync(csvPath, row + "\n");
console.log(
  `   recorded: status=${r.status ?? "?"} total_tokens=${r.total_tokens ?? "?"} weighted=${r.weighted_token_expenditure ?? "?"}`,
);
