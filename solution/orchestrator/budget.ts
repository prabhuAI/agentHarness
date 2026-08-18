import type { BuildRoute } from "../ir/types.js";

export type BudgetState = "green" | "yellow" | "red";

export interface BudgetSnapshot {
  state: BudgetState;
  estimatedWeightedTokens: number;
  maximumWeightedTokens: number;
  llmRepairAttempts: number;
  maximumLlmRepairAttempts: number;
}

export class TokenGovernor {
  private repairAttempts = 0;

  constructor(
    private readonly maximumWeightedTokens = 18_000,
    private readonly maximumRepairAttempts = 2,
  ) {}

  snapshot(route: BuildRoute): BudgetSnapshot {
    const estimate = route === "compile" ? 1_500 : route === "hybrid" ? 5_000 : 12_000;
    const ratio = estimate / this.maximumWeightedTokens;
    return {
      state: ratio >= 1 || this.repairAttempts >= this.maximumRepairAttempts ? "red" : ratio >= 0.6 ? "yellow" : "green",
      estimatedWeightedTokens: estimate,
      maximumWeightedTokens: this.maximumWeightedTokens,
      llmRepairAttempts: this.repairAttempts,
      maximumLlmRepairAttempts: this.maximumRepairAttempts,
    };
  }

  canUseLlmRepair(route: BuildRoute): boolean {
    return this.snapshot(route).state !== "red" && this.repairAttempts < this.maximumRepairAttempts;
  }

  recordLlmRepair(): void { this.repairAttempts += 1; }
}

export function weightedTokens(input: number, output: number, cacheRead: number): number {
  return input + output * 3 + cacheRead * 0.1;
}
