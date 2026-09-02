export type FailureCategory =
  | "dependency" | "compile" | "runtime" | "configuration" | "validation"
  | "persistence" | "selector" | "rendering" | "journey" | "environment" | "custom-feature" | "unknown";

/**
 * Marker the startup probe writes to its captured output when the port was held
 * by a process outside the generated app. It lets classification tell an
 * environmental block apart from a genuine application runtime failure.
 */
export const FOREIGN_PORT_MARKER = "PORT_BLOCKED_BY_FOREIGN_PROCESS";

export interface ClassifiedFailure {
  category: FailureCategory;
  summary: string;
  relevantOutput: string;
}

export function classifyFailure(command: "test" | "build" | "startup" | "artifacts", output: string): ClassifiedFailure {
  const clipped = output.trim().slice(-3000);
  const lower = output.toLowerCase();
  if (command === "startup" && lower.includes(FOREIGN_PORT_MARKER.toLowerCase())) return { category: "environment", summary: "The configured port was held by a process outside the generated app, so the live HTTP serve could not be verified even though the app compiled and its journey suite passed.", relevantOutput: clipped };
  if (lower.includes("cannot find module") || lower.includes("eresolve")) return { category: "dependency", summary: "A pinned dependency could not be resolved.", relevantOutput: clipped };
  if (lower.includes("type error") || lower.includes("tsc") || lower.includes("failed to resolve import")) return { category: "compile", summary: "The generated application does not compile.", relevantOutput: clipped };
  if (lower.includes("localstorage") || lower.includes("storage")) return { category: "persistence", summary: "The persistence journey failed.", relevantOutput: clipped };
  if (lower.includes("unable to find") || lower.includes("role=")) return { category: "selector", summary: "An accessible product selector did not match.", relevantOutput: clipped };
  if (lower.includes("product.config") || (lower.includes("configuration") && lower.includes("undefined"))) return { category: "configuration", summary: "The compiled product configuration is inconsistent.", relevantOutput: clipped };
  if (command === "startup") return { category: "runtime", summary: "The generated application did not start and answer an HTTP request.", relevantOutput: clipped };
  if (command === "artifacts") return { category: "validation", summary: "The required submission artifacts failed validation.", relevantOutput: clipped };
  return { category: command === "build" ? "compile" : "journey", summary: `${command} verification failed.`, relevantOutput: clipped };
}
