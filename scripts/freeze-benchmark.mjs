import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.resolve(root, process.argv[2] ?? "artifacts/benchmark-report.json");
const destination = path.join(root, "submission", "benchmark-report.json");
const report = JSON.parse(await readFile(source, "utf8"));

if (report?.runtime?.node !== "v22.19.0" || report?.runtime?.npm !== "10.9.3") {
  throw new Error(`Refusing to freeze: benchmark runtime must be Node v22.19.0/npm 10.9.3; received ${report?.runtime?.node ?? "missing"}/${report?.runtime?.npm ?? "missing"}.`);
}
if (!Array.isArray(report.rows) || report.rows.length < 20 || report?.summary?.total !== report.rows.length) {
  throw new Error("Refusing to freeze: benchmark report must contain at least 20 rows and a matching aggregate summary.");
}
const raw = JSON.stringify(report);
if (/(api[_-]?key|authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|\/Users\/|\/home\/[^/]+\/)/iu.test(raw)) {
  throw new Error("Refusing to freeze: benchmark report contains a possible credential or machine-specific path.");
}
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination);
console.log(`Benchmark evidence frozen in ${path.relative(root, destination)}`);
