export interface BenchmarkMeasurement {
  functional_success: boolean;
  first_pass_success: boolean;
  build_success: boolean;
  journey_success: boolean;
  persistence_success: boolean;
  model_calls: number;
  weighted_tokens: number;
  runtime_ms: number;
  status: string;
  category: string;
}

const ratio = (count: number, total: number): number => total === 0 ? 0 : count / total;

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)]!;
}

export function summarizeBenchmark(rows: BenchmarkMeasurement[]) {
  const total = rows.length;
  const successful = rows.filter((row) => row.functional_success);
  const weighted = successful.map((row) => row.weighted_tokens);
  const categories = [...new Set(rows.map((row) => row.category))].sort();
  return {
    total,
    successful: successful.length,
    functional_success_rate: ratio(successful.length, total),
    first_pass_success_rate: ratio(rows.filter((row) => row.first_pass_success).length, total),
    one_call_rate: ratio(rows.filter((row) => row.model_calls === 1).length, total),
    build_success_rate: ratio(rows.filter((row) => row.build_success).length, total),
    journey_success_rate: ratio(rows.filter((row) => row.journey_success).length, total),
    persistence_success_rate: ratio(rows.filter((row) => row.persistence_success).length, total),
    weighted_tokens: {
      median_successful: percentile(weighted, 0.5),
      p95_successful: percentile(weighted, 0.95),
      total_all_runs: rows.reduce((sum, row) => sum + row.weighted_tokens, 0),
    },
    runtime_ms: {
      median: percentile(rows.map((row) => row.runtime_ms), 0.5),
      p95: percentile(rows.map((row) => row.runtime_ms), 0.95),
    },
    status_counts: Object.fromEntries([...new Set(rows.map((row) => row.status))].sort().map((status) => [status, rows.filter((row) => row.status === status).length])),
    category_results: Object.fromEntries(categories.map((category) => {
      const categoryRows = rows.filter((row) => row.category === category);
      const categorySuccesses = categoryRows.filter((row) => row.functional_success).length;
      return [category, { total: categoryRows.length, successful: categorySuccesses, success_rate: ratio(categorySuccesses, categoryRows.length) }];
    })),
  };
}
