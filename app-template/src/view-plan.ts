import type { PresentationConfig, ProductConfig } from "./product-config.js";

export type ViewPlan = PresentationConfig;

/** The compiler owns presentation selection; the runtime renders that decision. */
export function resolveViewPlan(config: ProductConfig): ViewPlan {
  return config.presentation;
}
