import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TraceEvent {
  step: number;
  timestamp: string;
  agent: "product" | "router" | "compiler" | "qa" | "repair" | "delivery";
  action: string;
  status: "started" | "success" | "failed" | "skipped";
  [key: string]: unknown;
}

export class TraceWriter {
  private step = 0;
  private readonly destination: string;
  constructor(appRoot: string) { this.destination = path.join(appRoot, "trace.jsonl"); }
  async reset(): Promise<void> { this.step = 0; await writeFile(this.destination, "", "utf8"); }
  async resume(): Promise<void> {
    try { this.step = (await readFile(this.destination, "utf8")).split(/\r?\n/u).filter(Boolean).length; }
    catch { this.step = 0; }
  }
  async record(event: Omit<TraceEvent, "step" | "timestamp">): Promise<void> {
    this.step += 1;
    await appendFile(this.destination, `${JSON.stringify({ step: this.step, timestamp: new Date().toISOString(), ...event })}\n`, "utf8");
  }
}

export function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Text(await readFile(filePath, "utf8"));
}
