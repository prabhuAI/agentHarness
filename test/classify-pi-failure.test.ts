import { describe, expect, it } from "vitest";
import { classifyPiFailure, matchProviderError } from "../src/classify-pi-failure.js";

describe("classifyPiFailure", () => {
  it("detects authentication failures", () => {
    expect(classifyPiFailure("Error: 401 Unauthorized", 1, 0).kind).toBe("auth");
    expect(classifyPiFailure("Invalid API key provided", 1, 0).kind).toBe("auth");
  });

  it("detects rate-limit / quota errors", () => {
    expect(classifyPiFailure("HTTP 429 Too Many Requests", 1, 2).kind).toBe("rate_limit");
    expect(classifyPiFailure("insufficient_quota: you exceeded your quota", 1, 0).kind).toBe("rate_limit");
  });

  it("detects connection failures", () => {
    expect(classifyPiFailure("fetch failed: ECONNREFUSED 127.0.0.1:443", 1, 0).kind).toBe("connection");
    expect(classifyPiFailure("getaddrinfo ENOTFOUND api.provider.test", 1, 0).kind).toBe("connection");
  });

  it("prefers auth over the broader rate-limit family", () => {
    expect(classifyPiFailure("403 Forbidden: too many requests from key", 1, 0).kind).toBe("auth");
  });

  it("detects an unknown provider/model misconfiguration", () => {
    expect(classifyPiFailure('Unknown provider "bogus-provider".', 1, 0).kind).toBe("config");
    expect(classifyPiFailure("unsupported model: zai-org/typo", 1, 0).kind).toBe("config");
  });

  it("flags a clean exit with no model usage as no_model", () => {
    expect(classifyPiFailure("", 0, 0).kind).toBe("no_model");
  });

  it("flags a clean exit that made calls but produced no product report as model_output", () => {
    const failure = classifyPiFailure("", 0, 14);
    expect(failure.kind).toBe("model_output");
    expect(failure.summary).toMatch(/too weak|exhausted/i);
  });

  it("treats a clean exit that produced a verifiable product report as no failure", () => {
    // A fast compile-route run finishes in one turn with a written product report;
    // it must not be diagnosed as a too-weak model that never compiled an IR.
    expect(classifyPiFailure("", 0, 1, true)).toEqual({ kind: "none", summary: "" });
    expect(classifyPiFailure("", 0, 54, true).kind).toBe("none");
  });

  it("returns none when a failing exit has no recognizable cause", () => {
    expect(classifyPiFailure("some unrelated log line", 1, 3)).toEqual({ kind: "none", summary: "" });
  });

  it("does not treat model output that merely mentions errors as a provider failure", () => {
    // The local-model run's events contained the words "error" and "429" only
    // inside the model's own generated text, never on stderr.
    expect(matchProviderError("")).toBeNull();
  });
});
