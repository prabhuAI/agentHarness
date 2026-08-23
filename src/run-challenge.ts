import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareOutput } from "./prepare-output.js";
import { classifyPiFailure, matchProviderError } from "./classify-pi-failure.js";
import { auditAppPortAfterPi } from "./port-owner.js";
import { signalProcessTree, terminateProcessTree, usesDetachedProcessGroup } from "./process-tree.js";
import {
  composeResult,
  missingRequiredResultPaths,
  readPartialResult,
  rootStartCommand,
  writeResult,
} from "./result.js";
import { collectUsageFromJsonLines } from "./usage.js";
import type { RunResult } from "./types.js";
import { validateResultObject } from "./validate-result.js";
import { portHasListener, unavailableAppVerification, verifyGeneratedApp } from "./verify-app.js";
import { verifyRequiredArtifacts } from "./validate-artifacts.js";

interface Arguments {
  ideaFile: string;
  outputDirectory: string;
  prepareOnly: boolean;
  skipAppInstall: boolean;
}

export interface CommandResult {
  exitCode: number;
  timedOut: boolean;
}

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "..");
const APP_PORT = 3000;

export function runRequiresFailureExit(
  piExitCode: number,
  resultStatus: RunResult["status"],
  missingResultPaths: string[],
): boolean {
  return missingResultPaths.length > 0 || piExitCode !== 0 || resultStatus !== "success";
}

function printHelp(): void {
  console.log(`Usage: npm run challenge -- [options]

Options:
  --idea-file <path>      Idea prompt file (default: contract-public/development-idea.txt)
  --output-dir <path>     Generated app directory below output/ (default: output/app)
  --prepare-only          Reset the app from the seed without invoking Pi
  --skip-app-install      Do not run npm ci in the generated app
  --help                  Show this help

Environment:
  CHALLENGE_PROVIDER      Optional Pi provider override
  CHALLENGE_MODEL         Optional Pi model override
  CHALLENGE_THINKING      Optional Pi thinking level (default: off)
  CHALLENGE_TIMEOUT_MS    Wall-clock limit for Pi (default: 900000)
`);
}

export function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    ideaFile: path.join(REPOSITORY_ROOT, "contract-public", "development-idea.txt"),
    outputDirectory: path.join("output", "app"),
    prepareOnly: false,
    skipAppInstall: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }
    if (argument === "--prepare-only") {
      parsed.prepareOnly = true;
      continue;
    }
    if (argument === "--skip-app-install") {
      parsed.skipAppInstall = true;
      continue;
    }
    if (argument === "--idea-file" || argument === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      if (argument === "--idea-file") parsed.ideaFile = path.resolve(value);
      else parsed.outputDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function commandName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function runInherited(command: string, args: string[], cwd: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env, shell: false });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function summarizeEventLine(line: string): void {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === "tool_execution_end") {
      console.log(`[pi] completed tool: ${String(event.toolName ?? "unknown")}`);
    }
    if (event.type === "message_end") {
      const message = event.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, unknown> | undefined;
      if (message?.role === "assistant" && usage) {
        console.log(
          `[pi] model call completed: input=${String(usage.input ?? 0)} output=${String(usage.output ?? 0)}`,
        );
      }
    }
  } catch {
    // The unmodified line remains in events.jsonl for independent inspection.
  }
}

export async function runPi(
  args: string[],
  cwd: string,
  eventFile: string,
  stderrFile: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const piAgentDirectory = path.join(path.dirname(eventFile), "pi-agent");
  await mkdir(piAgentDirectory, { recursive: true });
  const modelConfiguration = await readFile(
    path.join(REPOSITORY_ROOT, "solution", "provider-config", "models.json"),
    "utf8",
  );
  await writeFile(path.join(piAgentDirectory, "models.json"), modelConfiguration, {
    encoding: "utf8",
    flag: "wx",
  });
  const events = createWriteStream(eventFile, { flags: "wx" });
  const errors = createWriteStream(stderrFile, { flags: "wx" });
  let lineBuffer = "";
  let piChild: ReturnType<typeof spawn> | undefined;

  try {
    return await new Promise<CommandResult>((resolve, reject) => {
      const piBinary = path.join(
        REPOSITORY_ROOT,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "pi.cmd" : "pi",
      );
      const child = spawn(piBinary, args, {
        cwd,
        detached: usesDetachedProcessGroup(),
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: piAgentDirectory,
          PI_OFFLINE: "1",
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      piChild = child;
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      const scheduleForceKill = () => {
        if (!killTimer) killTimer = setTimeout(() => signalProcessTree(child, "SIGKILL"), 5_000);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        signalProcessTree(child, "SIGTERM");
        scheduleForceKill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        events.write(chunk);
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split(/\r?\n/u);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) summarizeEventLine(line);
      });
      // Abort early on a fatal provider/transport error (bad key, quota/rate
      // limit, connection failure) instead of waiting out Pi's retries or the
      // wall-clock timeout. The full stderr still reaches the log and terminal.
      let stderrTail = "";
      let fatalProviderError = false;
      child.stderr.on("data", (chunk: Buffer) => {
        if (fatalProviderError || timedOut) return;
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-8_192);
        const provider = matchProviderError(stderrTail);
        if (provider) {
          fatalProviderError = true;
          console.error(`Aborting run early: ${provider.summary}`);
          signalProcessTree(child, "SIGTERM");
          scheduleForceKill();
        }
      });
      child.stderr.pipe(errors);
      child.stderr.pipe(process.stderr);
      child.once("error", (error) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        if (lineBuffer !== "") summarizeEventLine(lineBuffer);
        resolve({ exitCode: timedOut ? 124 : (code ?? 1), timedOut });
      });
    });
  } finally {
    if (piChild) await terminateProcessTree(piChild);
    await Promise.all([
      new Promise<void>((resolve) => events.end(resolve)),
      new Promise<void>((resolve) => errors.end(resolve)),
    ]);
  }
}

export function buildPiArguments(
  idea: string,
  systemPrompt: string,
  publicJourneys: string,
  appContext: string,
  artifactDirectory: string,
): string[] {
  const args = [
    "--mode",
    "json",
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--append-system-prompt",
    `${systemPrompt.trim()}\n\n${publicJourneys.trim()}\n\n${appContext.trim()}`,
    "--session-dir",
    path.join(artifactDirectory, "sessions"),
    "--extension",
    path.join(REPOSITORY_ROOT, "solution", "extensions", "protected-paths.ts"),
    "--extension",
    path.join(REPOSITORY_ROOT, "solution", "extensions", "product-compiler.ts"),
  ];
  if (process.env.CHALLENGE_PROVIDER) args.push("--provider", process.env.CHALLENGE_PROVIDER);
  if (process.env.CHALLENGE_MODEL) args.push("--model", process.env.CHALLENGE_MODEL);
  args.push("--thinking", process.env.CHALLENGE_THINKING ?? "off");
  args.push(`## Product idea\n\n${idea.trim()}\n`);
  return args;
}

function timeoutFromEnvironment(): number {
  const raw = process.env.CHALLENGE_TIMEOUT_MS ?? "900000";
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new Error("CHALLENGE_TIMEOUT_MS must be an integer of at least 1000");
  }
  return value;
}

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_MIN_MINOR = 19;

/**
 * Fail fast on an unsupported Node runtime before `npm ci` errors out mid-run
 * with a cryptic EBADENGINE message. The pinned engine is `>=22.19.0 <23`.
 */
export function assertSupportedNode(version: string = process.versions.node): void {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  if (major === REQUIRED_NODE_MAJOR && minor >= REQUIRED_NODE_MIN_MINOR) return;
  console.error(
    [
      ``,
      `✖ Unsupported Node.js version: v${version}`,
      `  This challenge requires Node.js ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MIN_MINOR}.x (>=22.19.0 <23).`,
      `  npm ci fails on any other major, so the run is stopped before it fails cryptically.`,
      ``,
      `  Switch Node with any one of:`,
      `    nvm:    nvm install && nvm use          # uses the pinned .nvmrc`,
      `    fnm:    fnm use --install-if-missing`,
      `    brew:   brew install node@22 && export PATH="$(brew --prefix node@22)/bin:$PATH"`,
      `    docker: docker build -t compilekit . && docker run --rm -e BERGET_API_KEY compilekit`,
      ``,
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  assertSupportedNode();
  const args = parseArguments(process.argv.slice(2));
  const idea = await readFile(args.ideaFile, "utf8");
  const outputDirectory = await prepareOutput(REPOSITORY_ROOT, args.outputDirectory);
  console.log(`Prepared clean application workspace: ${outputDirectory}`);

  if (!args.skipAppInstall) {
    const installCode = await runInherited(
      commandName("npm"),
      ["ci", "--ignore-scripts", "--prefer-offline"],
      outputDirectory,
    );
    if (installCode !== 0) throw new Error(`App dependency installation failed with exit code ${installCode}`);
  }
  if (args.prepareOnly) return;

  const [systemPrompt, publicJourneys, appContext] = await Promise.all([
    readFile(path.join(REPOSITORY_ROOT, "solution", "system-prompt.md"), "utf8"),
    readFile(path.join(REPOSITORY_ROOT, "contract-public", "journeys.md"), "utf8"),
    readFile(path.join(outputDirectory, "AGENTS.md"), "utf8"),
  ]);

  const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const artifactDirectory = path.join(REPOSITORY_ROOT, "artifacts", "runs", runId);
  await mkdir(path.join(artifactDirectory, "sessions"), { recursive: true });
  await writeFile(path.join(artifactDirectory, "idea.txt"), idea, "utf8");

  const eventFile = path.join(artifactDirectory, "events.jsonl");
  const stderrFile = path.join(artifactDirectory, "pi.stderr.log");
  const appPortHadListenerBeforePi = await portHasListener(APP_PORT);
  const pi = await runPi(
    buildPiArguments(idea, systemPrompt, publicJourneys, appContext, artifactDirectory),
    outputDirectory,
    eventFile,
    stderrFile,
    timeoutFromEnvironment(),
  );
  const portReclamation = await auditAppPortAfterPi(APP_PORT, outputDirectory, appPortHadListenerBeforePi);
  if (portReclamation.listener_after_pi) {
    const message = `${portReclamation.diagnostic}; pids=${portReclamation.process_ids.join(",") || "none"}`;
    if (portReclamation.reclaimed) console.log(message);
    else console.warn(message);
  }

  const usage = collectUsageFromJsonLines(await readFile(eventFile, "utf8"));
  const partial = await readPartialResult(outputDirectory);
  const canVerifyApp = pi.exitCode === 0 && usage.model_calls > 0;
  const startCommand = rootStartCommand(REPOSITORY_ROOT, outputDirectory);
  const piStderr = await readFile(stderrFile, "utf8").catch(() => "");
  // A written product report (partial.status other than "failed") means the model
  // did compile a verifiable Product IR — a clean exit then is success, not a
  // model_output failure, so the diagnosis must not misfire on it.
  const diagnosis = classifyPiFailure(piStderr, pi.exitCode, usage.model_calls, partial.status !== "failed");
  const failureSummary = pi.timedOut
    ? "Run exceeded CHALLENGE_TIMEOUT_MS and was terminated before finishing."
    : diagnosis.summary;
  if (failureSummary) console.error(`Run diagnosis: ${failureSummary}`);
  let verification = unavailableAppVerification(
    canVerifyApp ? "app verification had not completed" : "Pi did not complete with audited model usage",
  );
  let result = composeResult(partial, usage, pi.exitCode, verification, portReclamation, startCommand, failureSummary);
  const appResultPath = path.join(outputDirectory, "result.json");
  const rootResultPath = path.join(REPOSITORY_ROOT, "result.json");
  const requiredResultPaths = [appResultPath, rootResultPath];
  let resultPaths = await writeResult(
    outputDirectory,
    result,
    [rootResultPath],
  );
  if (canVerifyApp) {
    const appVerification = await verifyGeneratedApp(outputDirectory, artifactDirectory, { displayRoot: REPOSITORY_ROOT });
    const artifactCheck = await verifyRequiredArtifacts(outputDirectory);
    verification = {
      passed: appVerification.passed && artifactCheck.result === "passed",
      checks: [...appVerification.checks, artifactCheck],
    };
    result = composeResult(partial, usage, pi.exitCode, verification, portReclamation, startCommand, failureSummary);
    resultPaths = await writeResult(outputDirectory, result, [rootResultPath]);
  }
  const missingResultPaths = missingRequiredResultPaths(resultPaths, requiredResultPaths);
  const validationErrors = await validateResultObject(result);
  if (validationErrors.length > 0) {
    for (const error of validationErrors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Result written to ${resultPaths.join(" and ")}`);
  console.log(`Audit artifacts written to ${artifactDirectory}`);
  for (const missingResultPath of missingResultPaths) {
    console.error(`Required result destination was not written: ${missingResultPath}`);
  }
  if (pi.timedOut) console.error("Pi exceeded CHALLENGE_TIMEOUT_MS and was terminated.");
  if (runRequiresFailureExit(pi.exitCode, result.status, missingResultPaths)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
