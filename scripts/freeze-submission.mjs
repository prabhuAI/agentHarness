import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const app = path.join(root, "output", "app");
const destination = path.join(root, "submission", "verification");
const replace = process.argv.includes("--replace");

const required = ["result.json", "idea_spec.json", "product-ir.json", "summary.md", "trace.jsonl"];
const [{ stdout: commit }, { stdout: npm }, { stdout: status }] = await Promise.all([
  exec("git", ["rev-parse", "HEAD"], { cwd: root }),
  exec("npm", ["--version"]),
  exec("git", ["status", "--porcelain"], { cwd: root }),
]);
if (!process.version.startsWith("v22.19.")) {
  throw new Error(`Refusing to freeze: evidence must be produced with Node 22.19.x, not ${process.version}.`);
}
if (npm.trim() !== "10.9.3") {
  throw new Error(`Refusing to freeze: evidence must be produced with npm 10.9.3, not ${npm.trim()}.`);
}
if (status.trim() !== "") {
  throw new Error("Refusing to freeze: commit the reviewed implementation first so evidence identifies the exact clean source tree.");
}
let result;
try {
  result = JSON.parse(await readFile(path.join(app, "result.json"), "utf8"));
} catch {
  throw new Error("Refusing to freeze: run `npm run challenge` successfully first; output/app/result.json is missing or invalid.");
}
const allPassed = (entries) => Array.isArray(entries) && entries.length > 0 && entries.every((entry) => entry.result === "passed");
if (result.status !== "success" || result.model_calls < 1 || !allPassed(result.tests_run) || !allPassed(result.harness_checks)) {
  throw new Error("Refusing to freeze: result.json is not a fully verified successful run.");
}

if (replace) await rm(destination, { recursive: true, force: true });
else {
  try {
    await readFile(path.join(destination, "result.json"), "utf8");
    throw new Error("Submission evidence already exists. Re-run with --replace only after a newer successful scored run.");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Submission evidence")) throw error;
  }
}
await mkdir(destination, { recursive: true });
for (const name of required) await cp(path.join(app, name), path.join(destination, name));

const metadata = {
  frozen_at: new Date().toISOString(),
  commit: commit.trim(),
  runtime: { node: process.version, npm: npm.trim() },
  provider_models: [...new Set((result.call_log ?? []).map((entry) => entry.model).filter(Boolean))],
  commands: ["npm run check", "npm run challenge", "npm run validate:result -- output/app/result.json"],
  note: "Raw provider events and session logs are intentionally excluded because they may contain prompts, machine paths, or credentials.",
};
await writeFile(path.join(destination, "run-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

const suspicious = /(api[_-]?key|authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|\/Users\/|\/home\/[^/]+\/)/iu;
for (const name of [...required, "run-metadata.json"]) {
  const content = await readFile(path.join(destination, name), "utf8");
  if (suspicious.test(content)) {
    await rm(destination, { recursive: true, force: true });
    throw new Error(`Refusing to freeze: ${name} contains a possible credential or machine-specific path.`);
  }
}
console.log(`Sanitized verification evidence frozen in ${path.relative(root, destination)}`);
