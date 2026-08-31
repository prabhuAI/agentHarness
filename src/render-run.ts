// Standalone run reporter. Reads the artifacts a completed `npm run challenge`
// already wrote (trace.jsonl, result.json, idea.txt) and produces:
//   1. a narrated console timeline + token summary (the "live-feeling" recap);
//   2. a self-contained HTML report at output/app/run-report.html.
//
// It is READ-ONLY over scored artifacts and writes only the non-scored HTML
// report, so it can never affect a scored outcome. Usable two ways:
//   • directly:  npm run report            (recaps the latest run)
//   • embedded:  emitRunReport(...)         (called at the end of a run, guarded)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  narrateTraceLines,
  parseTrace,
  renderHtmlReport,
  tokenSummaryLines,
  type ResultLike,
} from "../solution/telemetry/render-report.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "..");

const readOptional = async (filePath: string): Promise<string> => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
};

export interface EmitOptions {
  outputDirectory: string;
  ideaText?: string | undefined;
  toConsole?: boolean | undefined;
  htmlPath?: string | undefined;
}

/**
 * Render the console recap and write the HTML report for one run. Returns the
 * HTML path written (or undefined if there was nothing to report). Never throws
 * for missing artifacts — callers embedding this in the run must stay unaffected.
 */
export async function emitRunReport(options: EmitOptions): Promise<string | undefined> {
  const { outputDirectory, toConsole = true } = options;
  const traceRaw = await readOptional(path.join(outputDirectory, "trace.jsonl"));
  if (traceRaw.trim() === "") return undefined;
  const resultRaw =
    (await readOptional(path.join(outputDirectory, "result.json"))) ||
    (await readOptional(path.join(REPOSITORY_ROOT, "result.json")));
  const idea =
    options.ideaText ??
    (await readOptional(path.join(outputDirectory, "idea_spec.json")).then((raw) => {
      try {
        const spec = JSON.parse(raw) as Record<string, unknown>;
        return typeof spec.core_utility === "string" ? spec.core_utility : "";
      } catch {
        return "";
      }
    }));

  const events = parseTrace(traceRaw);
  let result: ResultLike = {};
  try {
    result = resultRaw ? (JSON.parse(resultRaw) as ResultLike) : {};
  } catch {
    result = {};
  }

  if (toConsole) {
    const lines = [
      "",
      "━━━ CompileKit run recap ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ...narrateTraceLines(events),
      "",
      ...tokenSummaryLines(result),
      "",
    ];
    console.log(lines.join("\n"));
  }

  const htmlPath = options.htmlPath ?? path.join(outputDirectory, "run-report.html");
  const html = renderHtmlReport({ idea: idea || "(idea text unavailable)", events, result });
  await writeFile(htmlPath, html, "utf8");
  if (toConsole) console.log(`📄 HTML run report: ${htmlPath}\n`);
  return htmlPath;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dirFlag = argv.indexOf("--output-dir");
  const outputDirectory =
    dirFlag !== -1 && argv[dirFlag + 1]
      ? path.resolve(argv[dirFlag + 1] as string)
      : path.join(REPOSITORY_ROOT, "output", "app");
  const ideaText = await readOptional(path.join(REPOSITORY_ROOT, "contract-public", "development-idea.txt"));
  const written = await emitRunReport({
    outputDirectory,
    ideaText: ideaText.trim() || undefined,
  });
  if (!written) {
    console.error(
      `No trace.jsonl found under ${outputDirectory}. Run \`npm run challenge\` first, or pass --output-dir <path>.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
