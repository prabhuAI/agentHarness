import type { CustomFeatureProps } from "./custom-feature-api.js";

/**
 * Prewired extension slot. Deterministically compiled products leave this
 * empty; a bounded custom route replaces only this small component.
 */
export default function CustomFeature(_props: CustomFeatureProps) {
  return null;
}
