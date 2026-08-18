import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { NormalizedProductIR } from "../ir/types.js";

export async function generateLaunchKit(appRoot: string, ir: NormalizedProductIR): Promise<void> {
  const entity = ir.entities[0];
  const content = [
    `# Launch Kit — ${ir.product.name}`,
    "",
    "## Positioning",
    "",
    `${ir.product.name} helps ${ir.product.targetUser.toLowerCase()} ${ir.product.description.toLowerCase()}`,
    "",
    "## Tagline",
    "",
    `> ${ir.product.tagline}`,
    "",
    "## Landing page",
    "",
    `### ${ir.product.tagline}`,
    "",
    `${ir.product.description} Add the first ${entity.name}, keep the collection current, and return whenever you need a clear answer. No account or external service required.`,
    "",
    "## Demo plan",
    "",
    `1. Open the empty ${ir.product.name} workspace.`,
    `2. Add a complete ${entity.name}.`,
    `3. Demonstrate search, filtering, and a derived summary.`,
    "4. Refresh the page to prove persistence.",
    "5. Edit and remove the entry.",
    "",
    "## Announcement draft",
    "",
    `We built ${ir.product.name}: ${ir.product.tagline} It turns a focused workflow into a private, persistent browser app with no setup beyond npm run dev.`,
    "",
    "## Product Hunt draft",
    "",
    `**${ir.product.name}** — ${ir.product.tagline}\n\nBuilt for ${ir.product.targetUser}. Fast, local-first, and intentionally small.`,
    "",
  ].join("\n");
  await writeFile(path.join(appRoot, "launch-kit.md"), content, "utf8");
}
