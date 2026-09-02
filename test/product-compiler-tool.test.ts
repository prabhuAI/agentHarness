import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PUBLIC_BOOK_LENDING_IR } from "../benchmarks/public-fixture.js";
import { registerProductCompiler } from "../solution/extensions/product-compiler.js";
import { verifyRequiredArtifacts } from "../src/validate-artifacts.js";

interface CapturedTool {
  name: string;
  execute: (...args: unknown[]) => Promise<{ terminate?: boolean; content: Array<{ type: string; text: string }> }>;
}

describe("terminating product compiler tool", () => {
  it("turns one Product IR call into a verified artifact package without a follow-up turn", async () => {
    const appRoot = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-tool-"));
    const tools: CapturedTool[] = [];
    const success: ExecResult = { stdout: "passed", stderr: "", code: 0, killed: false };
    const fakePi = {
      registerTool: (tool: CapturedTool) => { tools.push(tool); },
      on: () => undefined,
      exec: async () => success,
    } as unknown as ExtensionAPI;
    try {
      registerProductCompiler(fakePi, appRoot, { verifyStartup: async () => ({ served: true, portBlockedByForeignProcess: false }) });
      expect(tools.map((tool) => tool.name)).toEqual(["compile_product", "finalize_product"]);
      const compiler = tools[0]!;
      const result = await compiler.execute("call-1", PUBLIC_BOOK_LENDING_IR, undefined, undefined, {});
      expect(result.terminate).toBe(true);
      expect(result.content[0]?.text).toContain("VERIFIED_PASS");
      expect((await verifyRequiredArtifacts(appRoot)).result).toBe("passed");
      const report = JSON.parse(await readFile(path.join(appRoot, "report.partial.json"), "utf8")) as Record<string, unknown>;
      expect(report.status).toBe("success");
      expect(await readFile(path.join(appRoot, "trace.jsonl"), "utf8")).toContain('"strategy":"compile"');
    } finally { await rm(appRoot, { recursive: true }); }
  });

  it("runs the hybrid compile → focused patch → finalization lifecycle", async () => {
    const appRoot = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-hybrid-"));
    const tools: CapturedTool[] = [];
    let toolCallHandler: ((event: { toolName: string; input: Record<string, unknown> }) => { block?: boolean } | undefined) | undefined;
    const success: ExecResult = { stdout: "passed", stderr: "", code: 0, killed: false };
    const fakePi = {
      registerTool: (tool: CapturedTool) => { tools.push(tool); },
      on: (event: string, handler: typeof toolCallHandler) => { if (event === "tool_call") toolCallHandler = handler; },
      exec: async () => success,
    } as unknown as ExtensionAPI;
    try {
      registerProductCompiler(fakePi, appRoot, { verifyStartup: async () => ({ served: true, portBlockedByForeignProcess: false }) });
      const hybrid = { ...PUBLIC_BOOK_LENDING_IR, customRequirements: ["Import records from a proprietary device"] };
      const compiled = await tools[0]!.execute("call-1", hybrid, undefined, undefined, {});
      expect(compiled.terminate).not.toBe(true);
      expect(compiled.content[0]?.text).toContain("Implement only");
      expect(compiled.content[0]?.text).toContain("src/CustomFeature.tsx");
      expect(compiled.content[0]?.text).toContain("Do not read any files");
      expect(compiled.content[0]?.text).not.toContain("Relevant files: src/App.tsx");
      expect(toolCallHandler?.({ toolName: "read", input: { path: path.join(appRoot, "src/repository.ts") } })).toMatchObject({ block: true });
      expect(toolCallHandler?.({ toolName: "read", input: { path: path.join(appRoot, "src/CustomFeature.tsx") } })).toMatchObject({ block: true });
      expect(toolCallHandler?.({ toolName: "write", input: { path: path.join(appRoot, "src/CustomFeature.tsx") } })).toBeUndefined();
      expect(toolCallHandler?.({ toolName: "read", input: { path: path.join(appRoot, "src/CustomFeature.tsx") } })).toBeUndefined();
      const finalized = await tools[1]!.execute("call-2", {}, undefined, undefined, {});
      expect(finalized.terminate).toBe(true);
      expect(finalized.content[0]?.text).toContain("VERIFIED_PASS");
      expect((await verifyRequiredArtifacts(appRoot)).result).toBe("passed");
    } finally { await rm(appRoot, { recursive: true }); }
  });

  it("terminates a compile-route invariant failure without spending model repair turns", async () => {
    const appRoot = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-compile-failure-"));
    const tools: CapturedTool[] = [];
    const failure: ExecResult = { stdout: "one compiled journey failed", stderr: "", code: 1, killed: false };
    const fakePi = {
      registerTool: (tool: CapturedTool) => { tools.push(tool); },
      on: () => undefined,
      exec: async () => failure,
    } as unknown as ExtensionAPI;
    try {
      registerProductCompiler(fakePi, appRoot, { verifyStartup: async () => ({ served: true, portBlockedByForeignProcess: false }) });
      const compiled = await tools[0]!.execute("call-1", PUBLIC_BOOK_LENDING_IR, undefined, undefined, {});
      expect(compiled.terminate).toBe(true);
      expect(compiled.content[0]?.text).toContain("Deterministic compile invariant failed");
      const report = JSON.parse(await readFile(path.join(appRoot, "report.partial.json"), "utf8")) as {
        status: string;
        tests_run: Array<{ command: string; journey: string; result: string }>;
      };
      expect(report.status).toBe("partial");
      expect(report.tests_run).toEqual([{
        command: "npm test (compiled journey suite)",
        journey: "The compiled product journey suite completes without failures",
        result: "failed",
      }]);
    } finally { await rm(appRoot, { recursive: true }); }
  });

  it("terminates a failing hybrid run when its bounded repair budget is exhausted", async () => {
    const appRoot = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-hybrid-budget-"));
    const tools: CapturedTool[] = [];
    const failure: ExecResult = { stdout: "", stderr: "journey assertion failed", code: 1, killed: false };
    const previous = process.env.MAX_LLM_REPAIR_ATTEMPTS;
    process.env.MAX_LLM_REPAIR_ATTEMPTS = "1";
    const fakePi = {
      registerTool: (tool: CapturedTool) => { tools.push(tool); },
      on: () => undefined,
      exec: async () => failure,
    } as unknown as ExtensionAPI;
    try {
      registerProductCompiler(fakePi, appRoot, { verifyStartup: async () => ({ served: true, portBlockedByForeignProcess: false }) });
      const hybrid = { ...PUBLIC_BOOK_LENDING_IR, customRequirements: ["Import records from a proprietary device"] };
      await tools[0]!.execute("call-1", hybrid, undefined, undefined, {});
      const finalized = await tools[1]!.execute("call-2", {}, undefined, undefined, {});
      expect(finalized.terminate).toBe(true);
      expect(finalized.content[0]?.text).toContain("Repair budget exhausted");
      const trace = await readFile(path.join(appRoot, "trace.jsonl"), "utf8");
      expect(trace).toContain('"agent":"delivery","action":"finalize","status":"failed"');
    } finally {
      if (previous === undefined) delete process.env.MAX_LLM_REPAIR_ATTEMPTS;
      else process.env.MAX_LLM_REPAIR_ATTEMPTS = previous;
      await rm(appRoot, { recursive: true });
    }
  });
});
