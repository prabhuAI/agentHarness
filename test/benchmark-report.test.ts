import { describe, expect, it } from "vitest";
import { percentile, summarizeBenchmark } from "../benchmarks/report.js";
import { BENCHMARK_CORE_CASES, BENCHMARK_IDEAS } from "../benchmarks/suite.js";

describe("benchmark reporting", () => {
  it("starts with twenty genuinely varied, categorized raw ideas", () => {
    expect(BENCHMARK_CORE_CASES).toHaveLength(20);
    expect(new Set(BENCHMARK_CORE_CASES.map((entry) => entry.id)).size).toBe(20);
    expect(new Set(BENCHMARK_CORE_CASES.map((entry) => entry.category)).size).toBeGreaterThanOrEqual(10);
    expect(BENCHMARK_IDEAS.length).toBeGreaterThanOrEqual(100);
  });

  it("computes decision-grade aggregate rates and nearest-rank percentiles", () => {
    const rows = [
      { functional_success: true, first_pass_success: true, build_success: true, journey_success: true, persistence_success: true, model_calls: 1, weighted_tokens: 100, runtime_ms: 1_000, status: "success", category: "workflow" },
      { functional_success: true, first_pass_success: false, build_success: true, journey_success: true, persistence_success: true, model_calls: 2, weighted_tokens: 300, runtime_ms: 3_000, status: "success", category: "workflow" },
      { functional_success: false, first_pass_success: false, build_success: false, journey_success: false, persistence_success: false, model_calls: 1, weighted_tokens: 900, runtime_ms: 9_000, status: "failed", category: "custom" },
    ];
    expect(percentile([100, 300], 0.5)).toBe(100);
    expect(summarizeBenchmark(rows)).toMatchObject({
      total: 3,
      successful: 2,
      functional_success_rate: 2 / 3,
      first_pass_success_rate: 1 / 3,
      one_call_rate: 2 / 3,
      weighted_tokens: { median_successful: 100, p95_successful: 300, total_all_runs: 1_300 },
      status_counts: { failed: 1, success: 2 },
    });
  });
});
