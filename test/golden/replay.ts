import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyCapabilities } from "../../solution/compiler/capability-map.js";
import { writeCompiledProduct } from "../../solution/compiler/compile.js";
import { normalizeProductIR } from "../../solution/ir/normalize.js";
import { validateProductIR } from "../../solution/ir/schema.js";
import type { RouteDecision } from "../../solution/ir/types.js";
import { deriveJourneys, type DerivedJourney } from "../../solution/qa/derive-journeys.js";

/**
 * The keyless projection of one `compile_product` transcript: the deterministic
 * artifacts a supported idea produces, with no model call and no `npm` run.
 *
 * It is assembled from the files `writeCompiledProduct` actually writes, so it
 * mirrors production byte-for-byte for the compile route — the exact surface
 * that prompt, schema, genome, design, and compiler changes move.
 */
export interface GoldenSnapshot {
  route: RouteDecision;
  journeys: DerivedJourney[];
  artifacts: {
    "product.config.json": unknown;
    "product-ir.json": unknown;
    "idea_spec.json": unknown;
    "summary.md": string;
  };
}

/**
 * Run one recorded Product IR through the same deterministic pipeline the
 * `compile_product` tool runs before it hands off to `npm test`/`npm run build`:
 * validate, normalize, route, derive journeys, and compile artifacts. Reuses the
 * production functions rather than re-implementing them, so a snapshot diff means
 * real behavior changed.
 */
export async function replayTranscript(rawIr: unknown): Promise<GoldenSnapshot> {
  const ir = normalizeProductIR(validateProductIR(rawIr));
  const route = classifyCapabilities(ir);
  const journeys = deriveJourneys(ir);
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-golden-"));
  try {
    await writeCompiledProduct(directory, ir, route, journeys);
    const [config, productIr, ideaSpec, summary, state] = await Promise.all([
      readFile(path.join(directory, "product.config.json"), "utf8"),
      readFile(path.join(directory, "product-ir.json"), "utf8"),
      readFile(path.join(directory, "idea_spec.json"), "utf8"),
      readFile(path.join(directory, "summary.md"), "utf8"),
      readFile(path.join(directory, ".compiler-state.json"), "utf8"),
    ]);
    const compilerState = JSON.parse(state) as { route: RouteDecision; journeys: DerivedJourney[] };
    return {
      route: compilerState.route,
      journeys: compilerState.journeys,
      artifacts: {
        "product.config.json": JSON.parse(config),
        "product-ir.json": JSON.parse(productIr),
        "idea_spec.json": JSON.parse(ideaSpec),
        "summary.md": summary,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Serialize a snapshot with keys in a stable, recursively sorted order so a
 * golden file diff reflects a value change, never an incidental key reordering.
 * Arrays keep their order because journey and field order is itself behavior.
 */
export function canonicalStringify(value: unknown): string {
  const sortKeys = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortKeys);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, sortKeys((input as Record<string, unknown>)[key])]),
      );
    }
    return input;
  };
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}
