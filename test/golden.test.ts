import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalStringify, replayTranscript } from "./golden/replay.js";

// Keyless golden-transcript regression gate. Each fixture is a recorded
// `compile_product` input (the IR the model emitted for one idea). Replaying it
// through the production deterministic pipeline must reproduce the committed
// snapshot exactly. A diff means prompt/schema/genome/design/compiler changes
// moved real output — review the diff, then re-record with `UPDATE_GOLDEN=1`.
//
//   npm run test:golden          # verify against committed snapshots
//   npm run test:golden:record   # re-record snapshots after an intended change

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, "golden", "fixtures");
const EXPECTED_DIR = path.join(HERE, "golden", "expected");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface Transcript {
  idea: string;
  ir: unknown;
}

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({ name: name.replace(/\.json$/u, ""), file: path.join(FIXTURES_DIR, name) }));

describe("golden transcripts", () => {
  it("ships recorded transcripts to replay", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(`replays ${fixture.name} to its committed snapshot`, async () => {
      const transcript = JSON.parse(readFileSync(fixture.file, "utf8")) as Transcript;
      const snapshot = canonicalStringify(await replayTranscript(transcript.ir));
      const expectedPath = path.join(EXPECTED_DIR, `${fixture.name}.snapshot.json`);

      if (UPDATE) {
        await mkdir(EXPECTED_DIR, { recursive: true });
        await writeFile(expectedPath, snapshot, "utf8");
        return;
      }

      let expected: string;
      try {
        expected = readFileSync(expectedPath, "utf8");
      } catch {
        throw new Error(
          `Missing golden snapshot for "${fixture.name}". Record it with: npm run test:golden:record`,
        );
      }
      expect(snapshot).toBe(expected);
    });
  }
});
